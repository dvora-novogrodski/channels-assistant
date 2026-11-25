// Types shared by the server's web channel and the React app.
// Slack never sees these; it gets its own Block Kit rendering.

/** Lifecycle of a simulated booking proposal. */
export type ProposalStatus = 'proposed' | 'confirmed' | 'cancelled' | 'superseded';

export interface ProposalStay {
  name: string;
  type: string;
  rating: number;
  nightlyRateUsd: number;
  rooms: number;
}

/** A simulated flight: demo data, with a link to compare real prices. */
export interface ProposalFlight {
  airline: string;
  flightNumber: string;
  originAirport: string;
  destinationAirport: string;
  departTime: string; // HH:MM local, outbound
  durationHours: number;
  stops: number;
  priceUsdPerTraveler: number; // round trip
  compareUrl: string;
}

export interface FlightLeg {
  date: string; // YYYY-MM-DD
  from: string;
  to: string;
  departs: string; // HH:MM
  arrives: string; // HH:MM
  arrivesNextDay: boolean;
}

export interface FlightTickets {
  recordLocator: string; // airline booking code, e.g. "K7QM2X"
  ticketNumbers: string[]; // one e-ticket per traveler
  seats: string[];
  outbound: FlightLeg;
  inbound: FlightLeg;
}

export interface StayVoucher {
  confirmationCode: string;
  checkIn: string; // YYYY-MM-DD
  checkOut: string;
  checkInTime: string;
  checkOutTime: string;
}

/** Issued when a trip is confirmed. */
export interface TripTickets {
  flight?: FlightTickets;
  stay: StayVoucher;
}

/** What a UI needs to render a trip package card. All money is computed in code, never by the LLM. */
export interface ProposalView {
  id: string;
  destinationId: string;
  destinationName: string;
  country: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  nights: number;
  travelers: number;
  stay: ProposalStay;
  flight?: ProposalFlight;
  costs: { stayUsd: number; flightsUsd: number };
  estimatedTotalUsd: number;
  dailyBudgetUsd: number; // typical spending per person per day, not included in the total
  paymentMethod: string; // demo card on file, e.g. "Visa •••• 4242 (demo)"
  status: ProposalStatus;
  bookingRef?: string; // e.g. "TRV-4821", only when confirmed
  tickets?: TripTickets; // only when confirmed
}

export interface DestinationCardView {
  id: string;
  name: string;
  country: string;
  region: string;
  budgetTier: string;
  dailyCostUsd: number;
  bestMonths: number[];
  tags: string[];
}

/** Why a turn failed. Drives the message the user sees and whether Retry makes sense. */
export type ErrorKind = 'rate_limit' | 'unavailable' | 'blocked' | 'busy' | 'internal';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string; // ISO timestamp
  proposal?: ProposalView; // present when this reply carries a booking card
  quickReplies?: string[]; // short follow-ups the user can send with one tap
  destinations?: DestinationCardView[]; // places found by the last search in this turn, shown as cards
  error?: { kind: ErrorKind; retryable: boolean }; // present when the turn failed
}

export type BookingView = ProposalView & { bookingRef: string; confirmedAt: string };

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
  paymentMethodId?: string; // one of SAVED_PAYMENT_METHODS; defaults to the first
}

/** Cards "on file" for every user. Only labels exist: no card numbers are stored or collected anywhere. */
export const SAVED_PAYMENT_METHODS = [
  { id: 'visa-4242', label: 'Visa •••• 4242', expires: '08/28' },
  { id: 'mastercard-5454', label: 'Mastercard •••• 5454', expires: '03/27' },
] as const;

export type SavedPaymentMethod = (typeof SAVED_PAYMENT_METHODS)[number];

export interface ResolveProposalResponse {
  proposal: ProposalView;
  reply: ChatMessage;
}

/** Body of any non-2xx response. */
export interface ApiErrorBody {
  error: string;
}
