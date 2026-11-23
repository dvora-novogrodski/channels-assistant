import { beforeEach, describe, expect, it } from 'vitest';
import { TripAssistant } from '../src/core/assistant.js';
import { NotFoundError } from '../src/core/errors.js';
import type { LlmReply } from '../src/core/llm/types.js';
import { parseDecision } from '../src/core/proposals.js';
import { InMemoryConversationStore, type Conversation } from '../src/core/store.js';
import { ScriptedLlm, textReply, toolReply } from './scriptedLlm.js';

const ALICE = 'web:alice';
const TODAY = new Date('2027-01-10T12:00:00Z');
const LISBON_BOOKING = { destinationId: 'lisbon-pt', startDate: '2027-05-12', nights: 5, travelers: 2 };

describe('parseDecision', () => {
  it.each(['confirm', 'Confirm!', ' yes, confirm ', 'book it'])('reads "%s" as confirm', (text) => {
    expect(parseDecision(text)).toBe('confirm');
  });

  it.each(['cancel', 'Cancel it.', 'no, cancel'])('reads "%s" as cancel', (text) => {
    expect(parseDecision(text)).toBe('cancel');
  });

  it.each(['can you confirm the price?', 'yes', 'cancel my Lisbon plans and find Rome'])(
    'leaves "%s" to the assistant',
    (text) => {
      expect(parseDecision(text)).toBeUndefined();
    },
  );
});

describe('proposal confirmation', () => {
  let store: InMemoryConversationStore;
  let conversation: Conversation;
  let llm: ScriptedLlm;
  let assistant: TripAssistant;
  let proposalId: string;

  beforeEach(async () => {
    store = new InMemoryConversationStore();
    conversation = store.createConversation(ALICE);
    llm = new ScriptedLlm(toolReply({ name: 'propose_booking', args: LISBON_BOOKING }), textReply('Confirm to book.'));
    assistant = new TripAssistant({ store, llm, now: () => TODAY });

    const { reply } = await assistant.handleMessage(ALICE, conversation.id, 'Book Lisbon');
    proposalId = reply.proposal?.id ?? '';
  });

  it('creates a booking with a reference only after confirmation', () => {
    expect(store.getUser(ALICE).bookings).toEqual([]);

    const { proposal, reply } = assistant.resolveProposal(ALICE, conversation.id, proposalId, 'confirm');

    expect(proposal).toMatchObject({ status: 'confirmed', bookingRef: expect.stringMatching(/^TRV-\d{4}$/) });
    expect(reply.text).toContain(`Reference ${proposal.bookingRef}`);
    expect(store.getUser(ALICE).bookings).toEqual([
      expect.objectContaining({ id: proposalId, bookingRef: proposal.bookingRef, confirmedAt: TODAY.toISOString() }),
    ]);
  });

  it('is idempotent when confirm is pressed twice', () => {
    const first = assistant.resolveProposal(ALICE, conversation.id, proposalId, 'confirm');
    const second = assistant.resolveProposal(ALICE, conversation.id, proposalId, 'confirm');

    expect(second.proposal.bookingRef).toBe(first.proposal.bookingRef);
    expect(store.getUser(ALICE).bookings).toHaveLength(1);
    expect(store.listMessages(ALICE, conversation.id)).toHaveLength(3);
  });

  it('cancels without booking and refuses a later confirm', () => {
    const cancelled = assistant.resolveProposal(ALICE, conversation.id, proposalId, 'cancel');
    const lateConfirm = assistant.resolveProposal(ALICE, conversation.id, proposalId, 'confirm');

    expect(cancelled.proposal.status).toBe('cancelled');
    expect(lateConfirm.proposal.status).toBe('cancelled');
    expect(lateConfirm.reply.text).toContain('no longer active');
    expect(store.getUser(ALICE).bookings).toEqual([]);
  });

  it('refuses to confirm a superseded proposal', async () => {
    llm.then(toolReply({ name: 'propose_booking', args: { ...LISBON_BOOKING, nights: 3 } }), textReply('Updated.'));
    await assistant.handleMessage(ALICE, conversation.id, 'Make it 3 nights');

    const { proposal, reply } = assistant.resolveProposal(ALICE, conversation.id, proposalId, 'confirm');

    expect(proposal.status).toBe('superseded');
    expect(reply.text).toContain('no longer active (it was superseded)');
    expect(store.getUser(ALICE).bookings).toEqual([]);
  });

  it('hides proposals from other users and unknown ids', () => {
    expect(() => assistant.resolveProposal('web:bob', conversation.id, proposalId, 'confirm')).toThrow(NotFoundError);
    expect(() => assistant.resolveProposal(ALICE, conversation.id, 'missing', 'confirm')).toThrow(NotFoundError);
  });

  it('confirms by typing "confirm" without calling the LLM', async () => {
    const requestsBefore = llm.requests.length;

    const { reply, updatedProposal } = await assistant.handleMessage(ALICE, conversation.id, 'Confirm');

    expect(llm.requests).toHaveLength(requestsBefore);
    expect(updatedProposal).toMatchObject({ id: proposalId, status: 'confirmed' });
    expect(reply.text).toContain('Stay booked: Lisbon');
    expect(store.listMessages(ALICE, conversation.id).map(({ role, text }) => `${role}:${text}`).slice(-2)).toEqual([
      'user:Confirm',
      `assistant:${reply.text}`,
    ]);
  });

  it('tells the model about a button confirmation on the next turn', async () => {
    assistant.resolveProposal(ALICE, conversation.id, proposalId, 'confirm');
    llm.then(textReply('You have 1 booking.'));

    await assistant.handleMessage(ALICE, conversation.id, 'What did I book?');

    const sentHistory = llm.requests.at(-1)?.messages ?? [];
    expect(sentHistory.slice(-3)).toEqual([
      { role: 'user', text: '(I pressed Confirm on the Lisbon proposal.)' },
      { role: 'assistant', text: expect.stringContaining('Stay booked: Lisbon'), toolCalls: [] },
      { role: 'user', text: 'What did I book?' },
    ]);
  });

  it('rejects a button decision while a turn is in progress', async () => {
    let finishTurn: (reply: LlmReply) => void = () => {};
    llm.then(() => new Promise<LlmReply>((resolve) => (finishTurn = resolve)));
    const turn = assistant.handleMessage(ALICE, conversation.id, 'Any tips?');

    const { proposal, reply } = assistant.resolveProposal(ALICE, conversation.id, proposalId, 'confirm');
    finishTurn(textReply('Pack light.'));
    await turn;

    expect(reply.error?.kind).toBe('busy');
    expect(proposal.status).toBe('proposed');
  });

  it('sends "confirm" to the assistant when nothing is pending', async () => {
    assistant.resolveProposal(ALICE, conversation.id, proposalId, 'cancel');
    llm.then(textReply('There is nothing to confirm right now.'));

    const { reply } = await assistant.handleMessage(ALICE, conversation.id, 'confirm');

    expect(reply.text).toBe('There is nothing to confirm right now.');
  });
});
