import { beforeEach, describe, expect, it } from 'vitest';
import { NotFoundError } from '../src/core/errors.js';
import { DEFAULT_TITLE, InMemoryConversationStore, type StoredMessage } from '../src/core/store.js';
import { sampleProposal } from './fixtures.js';

const ALICE = 'web:alice';
const BOB = 'web:bob';

function createTickingClock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++));
}

function userMessage(text: string): StoredMessage {
  return { id: `m-${text}`, role: 'user', text, createdAt: new Date().toISOString() };
}

describe('InMemoryConversationStore', () => {
  let store: InMemoryConversationStore;

  beforeEach(() => {
    store = new InMemoryConversationStore(createTickingClock());
  });

  describe('isolation between users', () => {
    it("hides one user's conversation from another user", () => {
      const conversation = store.createConversation(ALICE);

      expect(() => store.getConversation(BOB, conversation.id)).toThrow(NotFoundError);
      expect(() => store.listMessages(BOB, conversation.id)).toThrow(NotFoundError);
      expect(() => store.commit(BOB, conversation.id, { messages: [userMessage('hi')] })).toThrow(NotFoundError);
      expect(store.listConversations(BOB)).toEqual([]);
    });

    it('does not let another user take over an existing conversation id', () => {
      store.getOrCreateConversation(ALICE, 'slack:D1:111.222');

      expect(() => store.getOrCreateConversation(BOB, 'slack:D1:111.222')).toThrow(NotFoundError);
    });

    it('keeps bookings per user', () => {
      const conversation = store.createConversation(ALICE);
      store.commit(ALICE, conversation.id, { booking: { ...sampleProposal(), bookingRef: 'TRV-1', confirmedAt: '' } });

      expect(store.getUser(BOB).bookings).toEqual([]);
      expect(store.getUser(ALICE).bookings).toHaveLength(1);
    });
  });

  describe('conversations', () => {
    it('returns the same conversation for a repeated id', () => {
      const first = store.getOrCreateConversation(ALICE, 'slack:D1:111.222');
      const second = store.getOrCreateConversation(ALICE, 'slack:D1:111.222');

      expect(second).toEqual(first);
    });

    it('lists conversations most recently updated first', () => {
      const older = store.createConversation(ALICE);
      const newer = store.createConversation(ALICE);
      store.commit(ALICE, older.id, { messages: [userMessage('bump')] });

      expect(store.listConversations(ALICE).map(({ id }) => id)).toEqual([older.id, newer.id]);
    });

    it('titles a conversation from its first user message, truncated', () => {
      const conversation = store.createConversation(ALICE);
      expect(conversation.title).toBe(DEFAULT_TITLE);

      store.commit(ALICE, conversation.id, {
        messages: [userMessage('Somewhere warm for a long weekend in March, please'), userMessage('second message')],
      });

      expect(store.getConversation(ALICE, conversation.id).title).toBe('Somewhere warm for a long weekend in Ma…');
    });

    it('shows the current proposal status on the message that carries it', () => {
      const conversation = store.createConversation(ALICE);
      const proposal = sampleProposal();
      store.commit(ALICE, conversation.id, {
        proposals: [proposal],
        messages: [{ id: 'm-1', role: 'assistant', text: 'Here is your trip', createdAt: '', proposalId: proposal.id }],
      });

      store.commit(ALICE, conversation.id, { proposals: [{ ...proposal, status: 'confirmed' }] });

      const [message] = store.listMessages(ALICE, conversation.id);
      expect(message?.proposal?.status).toBe('confirmed');
      expect(store.getConversation(ALICE, conversation.id).proposals).toHaveLength(1);
    });
  });

  describe('commit', () => {
    it('applies history, messages, proposals, preferences and a booking together', () => {
      const conversation = store.createConversation(ALICE);
      const proposal = sampleProposal();

      store.commit(ALICE, conversation.id, {
        llmMessages: [{ role: 'user', text: 'Book Lisbon' }],
        messages: [userMessage('Book Lisbon')],
        proposals: [proposal],
        preferences: { homeAirport: 'TLV' },
        booking: { ...proposal, bookingRef: 'TRV-1', confirmedAt: '' },
      });

      const saved = store.getConversation(ALICE, conversation.id);
      expect(saved.llmHistory).toEqual([{ role: 'user', text: 'Book Lisbon' }]);
      expect(saved.messages.map(({ text }) => text)).toEqual(['Book Lisbon']);
      expect(saved.proposals.map(({ id }) => id)).toEqual([proposal.id]);
      expect(store.getUser(ALICE)).toMatchObject({ preferences: { homeAirport: 'TLV' }, bookings: [{ bookingRef: 'TRV-1' }] });
    });

    it('merges preferences with what was saved before', () => {
      const conversation = store.createConversation(ALICE);
      store.commit(ALICE, conversation.id, { preferences: { homeAirport: 'TLV' } });
      store.commit(ALICE, conversation.id, { preferences: { travelers: 2 } });

      expect(store.getUser(ALICE).preferences).toEqual({ homeAirport: 'TLV', travelers: 2 });
    });
  });

  describe('returns copies', () => {
    it('ignores changes made to a conversation that was read', () => {
      const conversation = store.createConversation(ALICE);
      conversation.messages.push(userMessage('not saved'));
      conversation.proposals.push(sampleProposal());
      conversation.title = 'changed outside';

      const saved = store.getConversation(ALICE, conversation.id);
      expect(saved).toMatchObject({ messages: [], proposals: [], title: DEFAULT_TITLE });
    });

    it('ignores changes made to a user that was read', () => {
      const user = store.getUser(ALICE);
      user.bookings.push({ ...sampleProposal(), bookingRef: 'TRV-1', confirmedAt: '' });
      user.preferences.homeAirport = 'TLV';

      expect(store.getUser(ALICE)).toEqual({ id: ALICE, bookings: [], preferences: {} });
    });

    it('ignores changes made to committed data after the commit', () => {
      const conversation = store.createConversation(ALICE);
      const proposal = sampleProposal();
      store.commit(ALICE, conversation.id, { proposals: [proposal] });

      proposal.status = 'confirmed';

      expect(store.getConversation(ALICE, conversation.id).proposals[0]?.status).toBe('proposed');
    });
  });
});
