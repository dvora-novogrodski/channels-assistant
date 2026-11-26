import { randomUUID } from 'node:crypto';
import type { BudgetTier, ChatMessage, ConversationSummary, ProposalView } from '@app/shared';
import { NotFoundError } from './errors.js';
import type { LlmMessage } from './llm/types.js';

export const DEFAULT_TITLE = 'New chat';
const TITLE_MAX_LENGTH = 40;

export type Proposal = ProposalView;
export type Booking = Proposal & { bookingRef: string; confirmedAt: string };

export type StoredMessage = Omit<ChatMessage, 'proposal'> & { proposalId?: string };

export interface UserPreferences {
  homeAirport?: string;
  travelers?: number;
  budgetTier?: BudgetTier;
  interests?: string[];
}

export interface User {
  id: string;
  bookings: Booking[];
  preferences: UserPreferences;
}

export interface Conversation {
  id: string;
  ownerId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  llmHistory: LlmMessage[];
  messages: StoredMessage[];
  proposals: Proposal[];
}

export interface ConversationChanges {
  llmMessages?: LlmMessage[];
  messages?: StoredMessage[];
  proposals?: Proposal[];
  preferences?: UserPreferences;
  booking?: Booking;
}

export interface ConversationStore {
  getUser(userId: string): User;
  createConversation(ownerId: string, conversationId?: string): Conversation;
  getConversation(ownerId: string, conversationId: string): Conversation;
  getOrCreateConversation(ownerId: string, conversationId: string): Conversation;
  listConversations(ownerId: string): ConversationSummary[];
  listMessages(ownerId: string, conversationId: string): ChatMessage[];
  commit(ownerId: string, conversationId: string, changes: ConversationChanges): void;
}

export class InMemoryConversationStore implements ConversationStore {
  private readonly users = new Map<string, User>();
  private readonly conversations = new Map<string, Conversation>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  getUser(userId: string): User {
    return structuredClone(this.storedUser(userId));
  }

  createConversation(ownerId: string, conversationId: string = randomUUID()): Conversation {
    if (this.conversations.has(conversationId)) {
      throw new Error(`Conversation already exists: ${conversationId}`);
    }

    const timestamp = this.now().toISOString();
    const conversation: Conversation = {
      id: conversationId,
      ownerId,
      title: DEFAULT_TITLE,
      createdAt: timestamp,
      updatedAt: timestamp,
      llmHistory: [],
      messages: [],
      proposals: [],
    };
    this.storedUser(ownerId);
    this.conversations.set(conversationId, conversation);
    return structuredClone(conversation);
  }

  getConversation(ownerId: string, conversationId: string): Conversation {
    return structuredClone(this.storedConversation(ownerId, conversationId));
  }

  getOrCreateConversation(ownerId: string, conversationId: string): Conversation {
    if (!this.conversations.has(conversationId)) return this.createConversation(ownerId, conversationId);
    return this.getConversation(ownerId, conversationId);
  }

  listConversations(ownerId: string): ConversationSummary[] {
    return [...this.conversations.values()]
      .filter((conversation) => conversation.ownerId === ownerId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(({ id, title, updatedAt }) => ({ id, title, updatedAt }));
  }

  listMessages(ownerId: string, conversationId: string): ChatMessage[] {
    const conversation = this.storedConversation(ownerId, conversationId);
    return conversation.messages.map(({ proposalId, ...message }) => {
      const proposal = conversation.proposals.find(({ id }) => id === proposalId);
      return structuredClone(proposal ? { ...message, proposal } : message);
    });
  }

  commit(ownerId: string, conversationId: string, changes: ConversationChanges): void {
    const conversation = this.storedConversation(ownerId, conversationId);
    const user = this.storedUser(ownerId);
    const { llmMessages = [], messages = [], proposals = [], preferences, booking } = structuredClone(changes);

    conversation.llmHistory.push(...llmMessages);
    proposals.forEach((proposal) => upsertById(conversation.proposals, proposal));
    messages.forEach((message) => this.appendMessage(conversation, message));
    if (preferences) user.preferences = { ...user.preferences, ...preferences };
    if (booking) user.bookings.push(booking);
  }

  private storedUser(userId: string): User {
    const existing = this.users.get(userId);
    if (existing) return existing;

    const user: User = { id: userId, bookings: [], preferences: {} };
    this.users.set(userId, user);
    return user;
  }

  private storedConversation(ownerId: string, conversationId: string): Conversation {
    const conversation = this.conversations.get(conversationId);
    if (!conversation || conversation.ownerId !== ownerId) throw new NotFoundError('Conversation not found');
    return conversation;
  }

  private appendMessage(conversation: Conversation, message: StoredMessage): void {
    conversation.messages.push(message);
    conversation.updatedAt = this.now().toISOString();
    if (conversation.title === DEFAULT_TITLE && message.role === 'user') conversation.title = toTitle(message.text);
  }
}

function upsertById<T extends { id: string }>(items: T[], item: T): void {
  const index = items.findIndex(({ id }) => id === item.id);
  if (index === -1) items.push(item);
  else items[index] = item;
}

function toTitle(text: string): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= TITLE_MAX_LENGTH) return singleLine || DEFAULT_TITLE;
  return `${singleLine.slice(0, TITLE_MAX_LENGTH - 1).trimEnd()}…`;
}
