import { beforeEach, describe, expect, it } from 'vitest';
import { NotFoundError } from '../src/core/errors.js';
import {
  DEFAULT_TITLE,
  InMemoryConversationStore,
  MAX_SEEN_EVENTS,
  type Proposal,
  type StoredMessage,
} from '../src/core/store.js';

const ALICE = 'web:alice';
const BOB = 'web:bob';

function createTickingClock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++));
}

function userMessage(text: string): StoredMessage {
  return { id: `m-${text}`, role: 'user', text, createdAt: new Date().toISOString() };
}

function sampleProposal(): Proposal {
  return {
    id: 'p-1',
    destinationId: 'lisbon-pt',
    destinationName: 'Lisbon',
    country: 'Portugal',
    startDate: '2027-05-12',
    endDate: '2027-05-17',
    nights: 5,
    travelers: 2,
    estimatedTotalUsd: 1400,
    status: 'proposed',
  };
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
      expect(store.listConversations(BOB)).toEqual([]);
    });

    it('does not let another user take over an existing conversation id', () => {
      store.getOrCreateConversation(ALICE, 'slack:D1:111.222');

      expect(() => store.getOrCreateConversation(BOB, 'slack:D1:111.222')).toThrow(NotFoundError);
    });

    it('keeps bookings per user', () => {
      store.getUser(ALICE).bookings.push({ ...sampleProposal(), bookingRef: 'TRV-1', confirmedAt: '' });

      expect(store.getUser(BOB).bookings).toEqual([]);
      expect(store.getUser(ALICE).bookings).toHaveLength(1);
    });
  });

  describe('conversations', () => {
    it('returns the same conversation for a repeated id', () => {
      const first = store.getOrCreateConversation(ALICE, 'slack:D1:111.222');
      const second = store.getOrCreateConversation(ALICE, 'slack:D1:111.222');

      expect(second).toBe(first);
    });

    it('lists conversations most recently updated first', () => {
      const older = store.createConversation(ALICE);
      const newer = store.createConversation(ALICE);
      store.appendMessage(older, userMessage('bump'));

      expect(store.listConversations(ALICE).map(({ id }) => id)).toEqual([older.id, newer.id]);
    });

    it('titles a conversation from its first user message, truncated', () => {
      const conversation = store.createConversation(ALICE);
      expect(conversation.title).toBe(DEFAULT_TITLE);

      store.appendMessage(conversation, userMessage('Somewhere warm for a long weekend in March, please'));
      store.appendMessage(conversation, userMessage('second message'));

      expect(conversation.title).toBe('Somewhere warm for a long weekend in Ma…');
    });

    it('shows the current proposal status on the message that carries it', () => {
      const conversation = store.createConversation(ALICE);
      const proposal = sampleProposal();
      conversation.proposals.push(proposal);
      store.appendMessage(conversation, {
        id: 'm-1',
        role: 'assistant',
        text: 'Here is your trip',
        createdAt: '',
        proposalId: proposal.id,
      });

      proposal.status = 'confirmed';

      const [message] = store.listMessages(ALICE, conversation.id);
      expect(message?.proposal?.status).toBe('confirmed');
    });
  });

  describe('markEventSeen', () => {
    it('accepts an event once and rejects duplicates', () => {
      expect(store.markEventSeen('D1:111.222')).toBe(true);
      expect(store.markEventSeen('D1:111.222')).toBe(false);
    });

    it('forgets the oldest events beyond the cap', () => {
      for (let index = 0; index <= MAX_SEEN_EVENTS; index++) {
        store.markEventSeen(`event-${index}`);
      }

      expect(store.markEventSeen('event-0')).toBe(true);
      expect(store.markEventSeen(`event-${MAX_SEEN_EVENTS}`)).toBe(false);
    });
  });
});
