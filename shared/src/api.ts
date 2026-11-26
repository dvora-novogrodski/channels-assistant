export type IsoDate = string;
export type IsoTimestamp = string;
export type TimeOfDay = string;

export type ProposalStatus = 'proposed' | 'confirmed' | 'cancelled' | 'superseded';

export interface ProposalStay {
  name: string;
  type: string;
  rating: number;
  nightlyRateUsd: number;
  rooms: number;
}

export interface ProposalFlight {
  airline: string;
  flightNumber: string;
  originAirport: string;
  destinationAirport: string;
  departTime: TimeOfDay;
  durationHours: number;
  stops: number;
  roundTripPriceUsdPerTraveler: number;
  compareUrl: string;
}

export interface FlightLeg {
  date: IsoDate;
  from: string;
  to: string;
  departs: TimeOfDay;
  arrives: TimeOfDay;
  arrivesNextDay: boolean;
}

export interface FlightTickets {
  recordLocator: string;
  ticketNumbers: string[];
  seats: string[];
  outbound: FlightLeg;
  inbound: FlightLeg;
}

export interface StayVoucher {
  confirmationCode: string;
  checkIn: IsoDate;
  checkOut: IsoDate;
  checkInTime: TimeOfDay;
  checkOutTime: TimeOfDay;
}

export interface TripTickets {
  flight?: FlightTickets;
  stay: StayVoucher;
}

export interface ProposalView {
  id: string;
  destinationId: string;
  destinationName: string;
  country: string;
  startDate: IsoDate;
  endDate: IsoDate;
  nights: number;
  travelers: number;
  stay: ProposalStay;
  flight?: ProposalFlight;
  costs: { stayUsd: number; flightsUsd: number };
  estimatedTotalUsd: number;
  dailyBudgetUsd: number;
  paymentMethod: string;
  status: ProposalStatus;
  bookingRef?: string;
  tickets?: TripTickets;
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

export type ErrorKind = 'rate_limit' | 'unavailable' | 'blocked' | 'busy' | 'internal';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: IsoTimestamp;
  proposal?: ProposalView;
  quickReplies?: string[];
  destinations?: DestinationCardView[];
  error?: { kind: ErrorKind; retryable: boolean };
}

export type BookingView = ProposalView & { bookingRef: string; confirmedAt: IsoTimestamp };

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: IsoTimestamp;
}

export interface CreateConversationRequest {
  userId: string;
}

export interface SendMessageRequest {
  userId: string;
  text: string;
}

export interface SendMessageResponse {
  reply: ChatMessage;
  updatedProposal?: ProposalView;
}

export const PROPOSAL_DECISIONS = ['confirm', 'cancel'] as const;

export type ProposalDecision = (typeof PROPOSAL_DECISIONS)[number];

export interface ResolveProposalRequest {
  userId: string;
  decision: ProposalDecision;
  paymentMethodId?: string;
}

export const SAVED_PAYMENT_METHODS = [
  { id: 'visa-4242', label: 'Visa •••• 4242', expires: '08/28' },
  { id: 'mastercard-5454', label: 'Mastercard •••• 5454', expires: '03/27' },
] as const;

export type SavedPaymentMethod = (typeof SAVED_PAYMENT_METHODS)[number];

export interface ResolveProposalResponse {
  proposal: ProposalView;
  reply: ChatMessage;
  changed: boolean;
}

export const BOOKING_STEPS = ['Holding your seats', 'Confirming your hotel', 'Processing payment', 'Issuing your tickets'] as const;
export const BOOKING_STEP_MS = 900;

export interface ApiErrorBody {
  error: string;
}
