import type {
  BookingView,
  ChatMessage,
  ConversationSummary,
  ProposalDecision,
  ResolveProposalResponse,
  SendMessageResponse,
} from '@app/shared';
import type { TripAssistant } from './assistant.js';
import type { ConversationStore } from './store.js';

interface TravelServiceDependencies {
  store: ConversationStore;
  assistant: TripAssistant;
}

export class TravelService {
  private readonly store: ConversationStore;
  private readonly assistant: TripAssistant;

  constructor({ store, assistant }: TravelServiceDependencies) {
    this.store = store;
    this.assistant = assistant;
  }

  listConversations(ownerId: string): ConversationSummary[] {
    return this.store.listConversations(ownerId);
  }

  listBookings(ownerId: string): BookingView[] {
    return this.store.getUser(ownerId).bookings.reverse();
  }

  listMessages(ownerId: string, conversationId: string): ChatMessage[] {
    return this.store.listMessages(ownerId, conversationId);
  }

  startConversation(ownerId: string): ConversationSummary {
    const { id, title, updatedAt } = this.store.createConversation(ownerId);
    return { id, title, updatedAt };
  }

  openConversation(ownerId: string, conversationId: string): void {
    this.store.getOrCreateConversation(ownerId, conversationId);
  }

  sendMessage(ownerId: string, conversationId: string, text: string): Promise<SendMessageResponse> {
    return this.assistant.handleMessage(ownerId, conversationId, text);
  }

  resolveProposal(
    ownerId: string,
    conversationId: string,
    proposalId: string,
    decision: ProposalDecision,
    paymentMethodId?: string,
  ): ResolveProposalResponse {
    return this.assistant.resolveProposal(ownerId, conversationId, proposalId, decision, paymentMethodId);
  }
}
