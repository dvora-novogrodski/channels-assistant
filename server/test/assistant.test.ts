import { beforeEach, describe, expect, it } from 'vitest';
import { HISTORY_WINDOW, MAX_TOOL_STEPS, TripAssistant, recentHistory } from '../src/core/assistant.js';
import { LlmError, type LlmMessage, type LlmReply } from '../src/core/llm/types.js';
import { InMemoryConversationStore, type Conversation } from '../src/core/store.js';
import { ScriptedLlm, textReply, toolReply } from './scriptedLlm.js';

const ALICE = 'web:alice';
const TODAY = new Date('2027-01-10T12:00:00Z');
const LISBON_BOOKING = { destinationId: 'lisbon-pt', startDate: '2027-05-12', nights: 5, travelers: 2 };

describe('TripAssistant', () => {
  let store: InMemoryConversationStore;
  let conversation: Conversation;

  beforeEach(() => {
    store = new InMemoryConversationStore();
    conversation = store.createConversation(ALICE);
  });

  function createAssistant(llm: ScriptedLlm, options: { demoFailures?: boolean } = {}) {
    return new TripAssistant({ store, llm, now: () => TODAY, ...options });
  }

  it('sends the previous exchange with a follow-up message', async () => {
    const llm = new ScriptedLlm(textReply('Try Lisbon in May.'), textReply('Lisbon has great food.'));
    const assistant = createAssistant(llm);

    await assistant.handleMessage(ALICE, conversation.id, 'Somewhere in Europe for May?');
    const { reply } = await assistant.handleMessage(ALICE, conversation.id, 'Tell me more about it');

    expect(reply.text).toBe('Lisbon has great food.');
    expect(llm.requests[1]?.messages).toEqual([
      { role: 'user', text: 'Somewhere in Europe for May?' },
      { role: 'assistant', text: 'Try Lisbon in May.', toolCalls: [] },
      { role: 'user', text: 'Tell me more about it' },
    ]);
    expect(store.listMessages(ALICE, conversation.id).map(({ text }) => text)).toEqual([
      'Somewhere in Europe for May?',
      'Try Lisbon in May.',
      'Tell me more about it',
      'Lisbon has great food.',
    ]);
  });

  it('returns a friendly error and saves nothing when the LLM fails, then recovers', async () => {
    const llm = new ScriptedLlm(new LlmError('unavailable', '503'), textReply('Back online!'));
    const assistant = createAssistant(llm);

    const failed = await assistant.handleMessage(ALICE, conversation.id, 'Hello?');

    expect(failed.reply.error).toEqual({ kind: 'unavailable', retryable: true });
    expect(conversation.llmHistory).toEqual([]);
    expect(store.listMessages(ALICE, conversation.id)).toEqual([]);

    const retried = await assistant.handleMessage(ALICE, conversation.id, 'Hello?');
    expect(retried.reply.text).toBe('Back online!');
    expect(retried.reply.error).toBeUndefined();
  });

  it('reports rate limits as retryable', async () => {
    const assistant = createAssistant(new ScriptedLlm(new LlmError('rate_limit', '429')));

    const { reply } = await assistant.handleMessage(ALICE, conversation.id, 'Hi');

    expect(reply.error).toEqual({ kind: 'rate_limit', retryable: true });
  });

  it('feeds a tool failure back to the model and still completes the turn', async () => {
    const llm = new ScriptedLlm(
      toolReply({ name: 'get_destination', args: { destinationId: 'atlantis-xx' } }),
      textReply("I couldn't find that place. Want suggestions instead?"),
    );

    const { reply } = await createAssistant(llm).handleMessage(ALICE, conversation.id, 'Tell me about Atlantis');

    expect(reply.text).toBe("I couldn't find that place. Want suggestions instead?");
    expect(llm.requests[1]?.messages.at(-1)).toMatchObject({
      role: 'tool',
      results: [{ name: 'get_destination', isError: true, output: expect.stringContaining('Unknown destinationId') }],
    });
  });

  it('does not keep a proposal when the LLM fails after proposing', async () => {
    const llm = new ScriptedLlm(
      toolReply({ name: 'propose_booking', args: LISBON_BOOKING }),
      new LlmError('unavailable', 'timeout'),
    );

    const { reply } = await createAssistant(llm).handleMessage(ALICE, conversation.id, 'Book Lisbon');

    expect(reply.error?.kind).toBe('unavailable');
    expect(conversation.proposals).toEqual([]);
    expect(conversation.llmHistory).toEqual([]);
  });

  it('attaches a proposal to the reply without creating a booking', async () => {
    const llm = new ScriptedLlm(
      toolReply({ name: 'propose_booking', args: LISBON_BOOKING }),
      textReply('Here is your Lisbon trip. Confirm to book it.'),
    );

    const { reply } = await createAssistant(llm).handleMessage(ALICE, conversation.id, 'Book Lisbon');

    expect(reply.proposal).toMatchObject({ destinationName: 'Lisbon', status: 'proposed', estimatedTotalUsd: 1400 });
    expect(store.getUser(ALICE).bookings).toEqual([]);
    expect(store.listMessages(ALICE, conversation.id).at(-1)?.proposal?.id).toBe(reply.proposal?.id);
  });

  it('supersedes the previous pending proposal when a new one is made', async () => {
    const llm = new ScriptedLlm(
      toolReply({ name: 'propose_booking', args: LISBON_BOOKING }),
      textReply('Proposed 5 nights.'),
      toolReply({ name: 'propose_booking', args: { ...LISBON_BOOKING, nights: 4 } }),
      textReply('Updated to 4 nights.'),
    );
    const assistant = createAssistant(llm);

    const first = await assistant.handleMessage(ALICE, conversation.id, 'Book Lisbon for 5 nights');
    const second = await assistant.handleMessage(ALICE, conversation.id, 'Make it 4 nights');

    expect(second.updatedProposal).toMatchObject({ id: first.reply.proposal?.id, status: 'superseded' });
    expect(second.reply.proposal).toMatchObject({ nights: 4, status: 'proposed' });
    expect(conversation.proposals.map(({ status }) => status)).toEqual(['superseded', 'proposed']);
  });

  it('rejects a second message while a turn is in progress', async () => {
    let finishFirstTurn: (reply: LlmReply) => void = () => {};
    const llm = new ScriptedLlm(() => new Promise<LlmReply>((resolve) => (finishFirstTurn = resolve)));
    const assistant = createAssistant(llm);

    const firstTurn = assistant.handleMessage(ALICE, conversation.id, 'First');
    const { reply } = await assistant.handleMessage(ALICE, conversation.id, 'Second');
    finishFirstTurn(textReply('Done with first'));

    expect(reply.error).toEqual({ kind: 'busy', retryable: true });
    expect((await firstTurn).reply.text).toBe('Done with first');
    expect(conversation.busy).toBe(false);
  });

  it('stops after too many tool steps without saving anything', async () => {
    const endlessSearch = toolReply({ name: 'search_destinations', args: {} });
    const llm = new ScriptedLlm(...Array.from({ length: MAX_TOOL_STEPS }, () => endlessSearch));

    const { reply } = await createAssistant(llm).handleMessage(ALICE, conversation.id, 'Anything');

    expect(reply.error?.kind).toBe('internal');
    expect(conversation.llmHistory).toEqual([]);
  });

  it('simulates an outage only when demo failures are enabled', async () => {
    const enabled = createAssistant(new ScriptedLlm(), { demoFailures: true });
    const disabled = createAssistant(new ScriptedLlm(textReply('Nothing failed')));

    expect((await enabled.handleMessage(ALICE, conversation.id, 'Simulate failure')).reply.error?.kind).toBe(
      'unavailable',
    );
    expect((await disabled.handleMessage(ALICE, conversation.id, 'simulate failure')).reply.text).toBe('Nothing failed');
  });
});

describe('recentHistory', () => {
  it('starts the window at a user message so it never opens with a tool result', () => {
    const turn: LlmMessage[] = [
      { role: 'user', text: 'q' },
      { role: 'assistant', toolCalls: [{ id: 'c', name: 'list_bookings', args: {} }] },
      { role: 'tool', results: [{ callId: 'c', name: 'list_bookings', output: {} }] },
      { role: 'assistant', text: 'a', toolCalls: [] },
    ];
    const history = Array.from({ length: 6 }, () => turn).flat();

    const window = recentHistory(history);

    expect(window.length).toBeLessThanOrEqual(HISTORY_WINDOW);
    expect(window[0]?.role).toBe('user');
    expect(window.at(-1)).toEqual(history.at(-1));
  });
});
