import type { KnownBlock } from '@slack/types';
import { z } from 'zod';
import {
  BOOKING_STEPS,
  formatCount,
  formatMonths,
  formatStops,
  formatUsd,
  type ChatMessage,
  type ConversationSummary,
  type DestinationCardView,
  type FlightLeg,
  type FlightTickets,
  type ProposalFlight,
  type ProposalStatus,
  type ProposalView,
  type TripTickets,
} from '@app/shared';

export const CONFIRM_ACTION_ID = 'proposal_confirm';
export const CANCEL_ACTION_ID = 'proposal_cancel';
export const NEW_TRIP_ACTION_ID = 'new_trip';
export const MY_TRIPS_ACTION_ID = 'my_trips';
export const CONTINUE_TRIP_ACTION_ID = 'continue_trip';
export const QUICK_REPLY_ACTION_PREFIX = 'quick_reply_';

export const SESSION_HINT =
  'Tip: everything stays in this chat. Type *new trip* to start fresh, or *my trips* to go back to an earlier trip.';
export const NO_EARLIER_TRIPS_TEXT = 'You have no trips yet. Tell me where you would like to go.';
const MAX_LISTED_TRIPS = 5;
const tripDateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const MAX_DESTINATION_CARDS = 5;
const MAX_DESTINATION_TAGS = 3;
const MAX_SECTION_TEXT = 2900;
const PARAGRAPH_BREAK = '\n\n';
const NEW_TRIP_SUGGESTIONS = ['Somewhere warm in February', 'A city break in Europe', 'Surprise me'];

const STATUS_LINES: Record<ProposalStatus, string> = {
  proposed: ':large_orange_circle: *Ready to book* · nothing is charged until you confirm',
  confirmed: ':white_check_mark: *Booked*',
  cancelled: ':x: *Cancelled*, nothing was booked',
  superseded: ':leftwards_arrow_with_hook: *Replaced by a newer proposal*',
};

const STATUS_SUMMARY_PREFIXES: Record<ProposalStatus, string> = {
  proposed: 'Proposed trip',
  confirmed: 'Booked trip',
  cancelled: 'Cancelled trip',
  superseded: 'Replaced trip proposal',
};

export const ProposalActionValueSchema = z.object({ conversationId: z.string(), proposalId: z.string() });
export const QuickReplyValueSchema = z.object({ text: z.string().min(1) });
export const ContinueTripValueSchema = z.object({ conversationId: z.string().min(1) });

export type ProposalActionValue = z.infer<typeof ProposalActionValueSchema>;
export type QuickReplyValue = z.infer<typeof QuickReplyValueSchema>;
export type ContinueTripValue = z.infer<typeof ContinueTripValueSchema>;

export interface SlackMessageContent {
  text: string;
  blocks: KnownBlock[];
}

export function toSlackMrkdwn(markdown: string): string {
  return markdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/__(.+?)__/g, '*$1*')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<$2|$1>')
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
    .replace(/^(\s*)[-*]\s+/gm, '$1• ');
}

export function buildReplyContent(
  reply: ChatMessage,
  conversationId: string,
  options: { showSessionHint: boolean },
): SlackMessageContent {
  const text = toReplyText(reply);
  const blocks: KnownBlock[] = [
    ...buildTextSections(text),
    ...buildDestinationBlocks(reply.destinations ?? []),
    ...buildReplyProposalBlocks(reply.proposal, conversationId),
    buildActionsBlock(reply.quickReplies ?? []),
    ...buildSessionHintBlocks(options.showSessionHint),
  ];
  return { text: withProposalSummary(text, reply.proposal), blocks };
}

export function buildBookingProgressContent(reply: ChatMessage, activeStep: number): SlackMessageContent {
  const steps = BOOKING_STEPS.map((label, index) => describeBookingStep(label, index, activeStep));
  return {
    text: 'Booking your trip…',
    blocks: [
      ...buildTextSections(toSlackMrkdwn(reply.text)),
      { type: 'divider' },
      mrkdwnSection(`*Booking your trip*\n${steps.join('\n')}`),
    ],
  };
}

export function buildTextSections(text: string): KnownBlock[] {
  return splitIntoSections(text).map(mrkdwnSection);
}

export function buildNewTripContent(): SlackMessageContent {
  const text = ':luggage: *New trip started.* Where would you like to go?';
  return { text, blocks: [mrkdwnSection(text), buildActionsBlock(NEW_TRIP_SUGGESTIONS)] };
}

export function buildTripListContent(trips: ConversationSummary[], currentConversationId: string | undefined): SlackMessageContent {
  if (trips.length === 0) return { text: NO_EARLIER_TRIPS_TEXT, blocks: [mrkdwnSection(NO_EARLIER_TRIPS_TEXT)] };
  const listed = trips.slice(0, MAX_LISTED_TRIPS);
  return {
    text: `Your trips: ${listed.map(({ title }) => title).join(', ')}`,
    blocks: [
      mrkdwnSection(':card_index_dividers: *Your trips*'),
      ...listed.map((trip) => buildTripRow(trip, trip.id === currentConversationId)),
    ],
  };
}

export function buildTripResumedContent(trip: ConversationSummary): SlackMessageContent {
  const text = `:leftwards_arrow_with_hook: *Back to: ${toSlackMrkdwn(trip.title)}*\nSend a message to continue this trip.`;
  return { text, blocks: [mrkdwnSection(text), buildActionsBlock([])] };
}

export function buildProposalBlocks(proposal: ProposalView, actionValue: ProposalActionValue): KnownBlock[] {
  return [
    { type: 'divider' },
    { type: 'header', text: { type: 'plain_text', text: describeRoute(proposal), emoji: true } },
    mrkdwnSection(describeTripLine(proposal)),
    { type: 'section', fields: [describeFlightField(proposal), describeStayField(proposal)] },
    ...buildCompareFlightsBlocks(proposal.flight),
    mrkdwnSection(describeTotal(proposal)),
    mrkdwnContext(describeStatus(proposal)),
    ...buildConfirmedTicketBlocks(proposal),
    ...buildDecisionButtons(proposal, actionValue),
  ];
}

export function parseActionValue(value: string | undefined): ProposalActionValue | undefined {
  return parseJson(value, ProposalActionValueSchema);
}

export function parseQuickReplyValue(value: string | undefined): QuickReplyValue | undefined {
  return parseJson(value, QuickReplyValueSchema);
}

export function parseContinueTripValue(value: string | undefined): ContinueTripValue | undefined {
  return parseJson(value, ContinueTripValueSchema);
}

function buildTripRow(trip: ConversationSummary, isCurrent: boolean): KnownBlock {
  const line = `*${toSlackMrkdwn(trip.title)}*\n_${describeTripActivity(trip, isCurrent)}_`;
  if (isCurrent) return mrkdwnSection(line);
  return {
    type: 'section',
    text: mrkdwnText(line),
    accessory: {
      type: 'button',
      action_id: CONTINUE_TRIP_ACTION_ID,
      text: { type: 'plain_text', text: 'Continue' },
      value: JSON.stringify({ conversationId: trip.id } satisfies ContinueTripValue),
    },
  };
}

function describeTripActivity(trip: ConversationSummary, isCurrent: boolean): string {
  const lastActive = `last active ${tripDateFormat.format(new Date(trip.updatedAt))}`;
  return isCurrent ? `Current trip · ${lastActive}` : lastActive;
}

function parseJson<T>(value: string | undefined, schema: z.ZodType<T>): T | undefined {
  if (!value) return undefined;
  try {
    return schema.parse(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function toReplyText(reply: ChatMessage): string {
  return reply.error ? `:warning: ${reply.text}` : toSlackMrkdwn(reply.text);
}

function withProposalSummary(text: string, proposal: ProposalView | undefined): string {
  return proposal ? `${text}${PARAGRAPH_BREAK}${describeProposal(proposal)}` : text;
}

function buildReplyProposalBlocks(proposal: ProposalView | undefined, conversationId: string): KnownBlock[] {
  return proposal ? buildProposalBlocks(proposal, { conversationId, proposalId: proposal.id }) : [];
}

function buildSessionHintBlocks(showSessionHint: boolean): KnownBlock[] {
  return showSessionHint ? [mrkdwnContext(SESSION_HINT)] : [];
}

function describeBookingStep(label: string, index: number, activeStep: number): string {
  if (index < activeStep) return `:white_check_mark: ${label}`;
  if (index === activeStep) return `:hourglass_flowing_sand: *${label}…*`;
  return `:white_small_square: ${label}`;
}

function splitIntoSections(text: string): string[] {
  const sections: string[] = [];
  let current = '';
  for (const paragraph of text.split(PARAGRAPH_BREAK)) {
    const combined = current ? `${current}${PARAGRAPH_BREAK}${paragraph}` : paragraph;
    if (combined.length <= MAX_SECTION_TEXT) {
      current = combined;
      continue;
    }
    if (current) sections.push(current);
    const pieces = splitIntoPieces(paragraph, MAX_SECTION_TEXT);
    current = pieces.pop() ?? '';
    sections.push(...pieces);
  }
  if (current) sections.push(current);
  return sections;
}

function splitIntoPieces(text: string, pieceLength: number): string[] {
  const pieceCount = Math.ceil(text.length / pieceLength);
  return Array.from({ length: pieceCount }, (_unused, index) => text.slice(index * pieceLength, (index + 1) * pieceLength));
}

function describeRoute(proposal: ProposalView): string {
  const { flight } = proposal;
  return flight ? `${flight.originAirport}  ✈  ${flight.destinationAirport}` : `Stay in ${proposal.destinationName}`;
}

function describeTripLine(proposal: ProposalView): string {
  return (
    `*${proposal.destinationName}, ${proposal.country}*\n` +
    `${proposal.startDate} → ${proposal.endDate} · ${proposal.nights} nights · ${formatCount(proposal.travelers, 'traveler')}`
  );
}

function describeTotal(proposal: ProposalView): string {
  return (
    `*Total  ${formatUsd(proposal.estimatedTotalUsd)}*\n:credit_card: ${proposal.paymentMethod}\n` +
    `_Plus about ${formatUsd(proposal.dailyBudgetUsd)} per person per day for food and activities._`
  );
}

function buildCompareFlightsBlocks(flight: ProposalFlight | undefined): KnownBlock[] {
  return flight ? [mrkdwnContext(`<${flight.compareUrl}|Compare prices on Google Flights>`)] : [];
}

function buildConfirmedTicketBlocks(proposal: ProposalView): KnownBlock[] {
  if (proposal.status !== 'confirmed' || !proposal.tickets) return [];
  return buildTicketBlocks(proposal, proposal.tickets);
}

function buildDecisionButtons(proposal: ProposalView, actionValue: ProposalActionValue): KnownBlock[] {
  if (proposal.status !== 'proposed') return [];
  const value = JSON.stringify(actionValue);
  return [
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          action_id: CONFIRM_ACTION_ID,
          style: 'primary',
          text: { type: 'plain_text', text: `Confirm & pay ${formatUsd(proposal.estimatedTotalUsd)}` },
          value,
        },
        { type: 'button', action_id: CANCEL_ACTION_ID, text: { type: 'plain_text', text: 'Cancel' }, value },
      ],
    },
  ];
}

function buildTicketBlocks(proposal: ProposalView, tickets: TripTickets): KnownBlock[] {
  return [
    { type: 'header', text: { type: 'plain_text', text: ':ticket: Your tickets', emoji: true } },
    ...buildFlightTicketBlocks(tickets.flight, proposal.flight?.flightNumber ?? ''),
    mrkdwnSection(describeHotelVoucher(proposal.stay.name, tickets)),
  ];
}

function buildFlightTicketBlocks(flightTickets: FlightTickets | undefined, flightNumber: string): KnownBlock[] {
  if (!flightTickets) return [];
  return [
    {
      type: 'section',
      fields: [
        mrkdwnText(describeLeg('Outbound', flightTickets.outbound, flightNumber)),
        mrkdwnText(describeLeg('Return', flightTickets.inbound, flightNumber)),
      ],
    },
    mrkdwnContext(
      `Booking code *${flightTickets.recordLocator}* · seats ${flightTickets.seats.join(', ')} · ` +
        `e-tickets ${flightTickets.ticketNumbers.join(', ')}`,
    ),
  ];
}

function describeLeg(label: string, leg: FlightLeg, flightNumber: string): string {
  const nextDayMarker = leg.arrivesNextDay ? ' (+1)' : '';
  return (
    `*${label}* · ${leg.date}\n*${leg.from} → ${leg.to}*\n` +
    `${flightNumber} · ${leg.departs} → ${leg.arrives}${nextDayMarker}`
  );
}

function describeHotelVoucher(stayName: string, { stay }: TripTickets): string {
  return (
    `:hotel: *Hotel voucher* · ${stayName}\nConfirmation *${stay.confirmationCode}* · ` +
    `check-in ${stay.checkIn} from ${stay.checkInTime} · check-out ${stay.checkOut} by ${stay.checkOutTime}`
  );
}

function buildDestinationBlocks(destinations: DestinationCardView[]): KnownBlock[] {
  if (destinations.length === 0) return [];
  const cards = destinations.slice(0, MAX_DESTINATION_CARDS).map(buildDestinationCard);
  return [{ type: 'divider' }, ...cards];
}

function buildDestinationCard(destination: DestinationCardView, index: number): KnownBlock {
  const tags = destination.tags.slice(0, MAX_DESTINATION_TAGS).map((tag) => `\`${tag}\``).join(' ');
  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text:
        `*${destination.name}*, ${destination.country}  ·  _${destination.region}_\n` +
        `*${formatUsd(destination.dailyCostUsd)}*/day · ${destination.budgetTier} · best in ${formatMonths(destination.bestMonths)}\n` +
        tags,
    },
    accessory: {
      type: 'button',
      action_id: `${QUICK_REPLY_ACTION_PREFIX}plan_${index}`,
      text: { type: 'plain_text', text: 'Plan this trip' },
      value: JSON.stringify({ text: `Plan a trip to ${destination.name}` } satisfies QuickReplyValue),
    },
  };
}

function buildActionsBlock(quickReplies: string[]): KnownBlock {
  return {
    type: 'actions',
    elements: [
      ...quickReplies.map((text, index) => ({
        type: 'button' as const,
        action_id: `${QUICK_REPLY_ACTION_PREFIX}${index}`,
        text: { type: 'plain_text' as const, text },
        value: JSON.stringify({ text } satisfies QuickReplyValue),
      })),
      {
        type: 'button',
        action_id: NEW_TRIP_ACTION_ID,
        text: { type: 'plain_text', text: ':luggage: New trip', emoji: true },
        value: 'new_trip',
      },
      {
        type: 'button',
        action_id: MY_TRIPS_ACTION_ID,
        text: { type: 'plain_text', text: ':card_index_dividers: My trips', emoji: true },
        value: 'my_trips',
      },
    ],
  };
}

function describeFlightField(proposal: ProposalView) {
  const { flight } = proposal;
  if (!flight) return mrkdwnText('*:airplane: Flight*\nNot included');
  return mrkdwnText(
    `*:airplane: Flight*\n${flight.airline} ${flight.flightNumber}\n` +
      `${formatStops(flight.stops)} · ${flight.durationHours}h · departs ${flight.departTime}\n` +
      `${formatUsd(flight.roundTripPriceUsdPerTraveler)} × ${proposal.travelers} = *${formatUsd(proposal.costs.flightsUsd)}*`,
  );
}

function describeStayField(proposal: ProposalView) {
  const { stay } = proposal;
  return mrkdwnText(
    `*:hotel: Stay*\n${stay.name} · ★ ${stay.rating}\n` +
      `${formatUsd(stay.nightlyRateUsd)}/night × ${proposal.nights} × ${formatCount(stay.rooms, 'room')}\n` +
      `= *${formatUsd(proposal.costs.stayUsd)}*`,
  );
}

function describeStatus(proposal: ProposalView): string {
  return [STATUS_LINES[proposal.status], describeStatusHint(proposal)].filter(Boolean).join(' · ');
}

function describeStatusHint(proposal: ProposalView): string | undefined {
  if (proposal.status === 'proposed') return 'or reply "confirm" / "cancel"';
  if (proposal.status === 'confirmed' && proposal.bookingRef) return `Reference *${proposal.bookingRef}*`;
  return undefined;
}

function describeProposal(proposal: ProposalView): string {
  const summary = `${STATUS_SUMMARY_PREFIXES[proposal.status]}: ${describeTripSummary(proposal)}`;
  if (proposal.status === 'proposed') return `${summary} Reply "confirm" or "cancel".`;
  if (proposal.status === 'confirmed') return `${summary} Reference ${proposal.bookingRef ?? ''}.`;
  return summary;
}

function describeTripSummary(proposal: ProposalView): string {
  const flight = proposal.flight ? ` with ${proposal.flight.airline} flights` : '';
  return (
    `${proposal.destinationName}, ${proposal.country}, ${proposal.startDate} → ${proposal.endDate}, ` +
    `${formatCount(proposal.travelers, 'traveler')}, ${proposal.stay.name}${flight}, total ${formatUsd(proposal.estimatedTotalUsd)}.`
  );
}

function mrkdwnText(text: string) {
  return { type: 'mrkdwn' as const, text };
}

function mrkdwnSection(text: string): KnownBlock {
  return { type: 'section', text: mrkdwnText(text) };
}

function mrkdwnContext(text: string): KnownBlock {
  return { type: 'context', elements: [mrkdwnText(text)] };
}
