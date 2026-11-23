// Types shared by the server's web channel and the React app.
// Slack never sees these; it gets its own Block Kit rendering.

/** Lifecycle of a simulated booking proposal. */
export type ProposalStatus = 'proposed' | 'confirmed' | 'cancelled' | 'superseded';

/** What a UI needs to render a booking card. */
export interface ProposalView {
  id: string;
  destinationId: string;
  destinationName: string;
  country: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  nights: number;
  travelers: number;
  estimatedTotalUsd: number; // computed in code, never by the LLM
  status: ProposalStatus;
  bookingRef?: string; // e.g. "TRV-4821", only when confirmed
}

/** Why a turn failed. Drives the message the user sees and whether Retry makes sense. */
export type ErrorKind = 'rate_limit' | 'unavailable' | 'blocked' | 'busy' | 'internal';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string; // ISO timestamp
  proposal?: ProposalView; // present when this reply carries a booking card
  error?: { kind: ErrorKind; retryable: boolean }; // present when the turn failed
}

export interface ConversationSummary {
  id: string;
  title: string; // first user message, truncated
  updatedAt: string;
}

// ---- HTTP request/response bodies (web channel) ----
// GET  /api/conversations?userId=                         -> ConversationSummary[]
// POST /api/conversations                                 -> ConversationSummary
// GET  /api/conversations/:id/messages?userId=            -> ChatMessage[]
// POST /api/conversations/:id/messages                    -> SendMessageResponse
// POST /api/conversations/:id/proposals/:proposalId       -> ResolveProposalResponse

export interface CreateConversationRequest {
  userId: string;
}

export interface SendMessageRequest {
  userId: string;
  text: string;
}

export interface SendMessageResponse {
  /** The assistant's reply (may carry `proposal` or `error`). */
  reply: ChatMessage;
  /** Set when this turn superseded or resolved an earlier card, so the UI can update it in place. */
  updatedProposal?: ProposalView;
}

export interface ResolveProposalRequest {
  userId: string;
  decision: 'confirm' | 'cancel';
}

export interface ResolveProposalResponse {
  proposal: ProposalView;
  reply: ChatMessage;
}

/** Body of any non-2xx response. */
export interface ApiErrorBody {
  error: string;
}
