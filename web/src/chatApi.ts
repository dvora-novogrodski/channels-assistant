import type {
  ApiErrorBody,
  BookingView,
  ChatMessage,
  ConversationSummary,
  CreateConversationRequest,
  ResolveProposalRequest,
  ResolveProposalResponse,
  SendMessageRequest,
  SendMessageResponse,
} from '@app/shared';

export type ProposalDecision = ResolveProposalRequest['decision'];

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function requestJson<T>(path: string, options: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
  const { method = 'GET', body } = options;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError(0, "Can't reach the server. Check your connection and try again.");
  }

  if (!response.ok) {
    const errorBody: Partial<ApiErrorBody> = await response.json().catch(() => ({}));
    throw new ApiRequestError(response.status, errorBody.error ?? `Request failed (${response.status}).`);
  }
  return response.json();
}

function conversationPath(conversationId: string): string {
  return `/api/conversations/${encodeURIComponent(conversationId)}`;
}

export const chatApi = {
  listConversations(userId: string) {
    return requestJson<ConversationSummary[]>(`/api/conversations?userId=${encodeURIComponent(userId)}`);
  },

  listBookings(userId: string) {
    return requestJson<BookingView[]>(`/api/bookings?userId=${encodeURIComponent(userId)}`);
  },

  createConversation(userId: string) {
    const body: CreateConversationRequest = { userId };
    return requestJson<ConversationSummary>('/api/conversations', { method: 'POST', body });
  },

  listMessages(userId: string, conversationId: string) {
    return requestJson<ChatMessage[]>(`${conversationPath(conversationId)}/messages?userId=${encodeURIComponent(userId)}`);
  },

  sendMessage(userId: string, conversationId: string, text: string) {
    const body: SendMessageRequest = { userId, text };
    return requestJson<SendMessageResponse>(`${conversationPath(conversationId)}/messages`, { method: 'POST', body });
  },

  resolveProposal(
    userId: string,
    conversationId: string,
    proposalId: string,
    decision: ProposalDecision,
    paymentMethodId?: string,
  ) {
    const body: ResolveProposalRequest = { userId, decision, paymentMethodId };
    return requestJson<ResolveProposalResponse>(
      `${conversationPath(conversationId)}/proposals/${encodeURIComponent(proposalId)}`,
      { method: 'POST', body },
    );
  },
};
