import type { KnownBlock } from '@slack/types';
import { z } from 'zod';
import type { ChatMessage, DestinationCardView, FlightLeg, ProposalStatus, ProposalView } from '@app/shared';

export const CONFIRM_ACTION_ID = 'proposal_confirm';
export const CANCEL_ACTION_ID = 'proposal_cancel';
export const NEW_TRIP_ACTION_ID = 'new_trip';
export const QUICK_REPLY_ACTION_PREFIX = 'quick_reply_';

export const SESSION_HINT = 'Tip: everything stays in this chat. Type *new trip* or press *New trip* to start fresh.';
const MAX_DESTINATION_CARDS = 5;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const STATUS_LINES: Record<ProposalStatus, string> = {
  proposed: ':large_orange_circle: *Ready to book* · nothing is charged until you confirm',
  confirmed: ':white_check_mark: *Booked*',
  cancelled: ':x: *Cancelled*, nothing was booked',
  superseded: ':leftwards_arrow_with_hook: *Replaced by a newer proposal*',
};

export const ProposalActionValueSchema = z.object({ conversationId: z.string(), proposalId: z.string() });
export const QuickReplyValueSchema = z.object({ text: z.string().min(1) });

export type ProposalActionValue = z.infer<typeof ProposalActionValueSchema>;
export type QuickReplyValue = z.infer<typeof QuickReplyValueSchema>;

export interface SlackMessageContent {
  text: string;
  blocks: KnownBlock[];
}

// Gemini replies in GitHub-style Markdown; Slack's mrkdwn uses *bold*, <url|label> links and no headings.
// &, < and > are escaped first so model text can never form Slack control sequences such as <!channel>.
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
  const text = reply.error ? `:warning: ${reply.text}` : toSlackMrkdwn(reply.text);
  const blocks: KnownBlock[] = [{ type: 'section', text: { type: 'mrkdwn', text } }];

  if (reply.destinations?.length) blocks.push(...buildDestinationBlocks(reply.destinations));
  if (reply.proposal) blocks.push(...buildProposalBlocks(reply.proposal, { conversationId, proposalId: reply.proposal.id }));
  blocks.push(buildActionsBlock(reply.quickReplies ?? []));
  if (options.showSessionHint) blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: SESSION_HINT }] });

  return { text: reply.proposal ? `${text}\n\n${describeProposal(reply.proposal)}` : text, blocks };
}

export function buildNewTripContent(): SlackMessageContent {
  const text = ':luggage: *New trip started.* Where would you like to go?';
  return {
    text,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text } },
      buildActionsBlock(['Somewhere warm in February', 'A city break in Europe', 'Surprise me']),
    ],
  };
}

export function buildProposalBlocks(proposal: ProposalView, actionValue: ProposalActionValue): KnownBlock[] {
  const route = proposal.flight
    ? `${proposal.flight.originAirport}  ✈  ${proposal.flight.destinationAirport}`
    : `Stay in ${proposal.destinationName}`;

  const blocks: KnownBlock[] = [
    { type: 'divider' },
    { type: 'header', text: { type: 'plain_text', text: route, emoji: true } },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `*${proposal.destinationName}, ${proposal.country}*\n` +
          `${proposal.startDate} → ${proposal.endDate} · ${proposal.nights} nights · ${pluralTravelers(proposal.travelers)}`,
      },
    },
    { type: 'section', fields: [describeFlightField(proposal), describeStayField(proposal)] },
  ];

  if (proposal.flight) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `<${proposal.flight.compareUrl}|Compare prices on Google Flights>` }],
    });
  }

  blocks.push(
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `*Total  ${usd(proposal.estimatedTotalUsd)}*\n:credit_card: ${proposal.paymentMethod}\n` +
          `_Plus about ${usd(proposal.dailyBudgetUsd)} per person per day for food and activities._`,
      },
    },
    { type: 'context', elements: [{ type: 'mrkdwn', text: describeStatus(proposal) }] },
  );

  if (proposal.status === 'confirmed' && proposal.tickets) blocks.push(...buildTicketBlocks(proposal));

  if (proposal.status === 'proposed') {
    const value = JSON.stringify(actionValue);
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          action_id: CONFIRM_ACTION_ID,
          style: 'primary',
          text: { type: 'plain_text', text: `Confirm & pay ${usd(proposal.estimatedTotalUsd)}` },
          value,
        },
        { type: 'button', action_id: CANCEL_ACTION_ID, text: { type: 'plain_text', text: 'Cancel' }, value },
      ],
    });
  }
  return blocks;
}

export function parseActionValue(value: string | undefined): ProposalActionValue | undefined {
  return parseJson(value, ProposalActionValueSchema);
}

export function parseQuickReplyValue(value: string | undefined): QuickReplyValue | undefined {
  return parseJson(value, QuickReplyValueSchema);
}

function parseJson<T>(value: string | undefined, schema: z.ZodType<T>): T | undefined {
  if (!value) return undefined;
  try {
    return schema.parse(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function buildTicketBlocks(proposal: ProposalView): KnownBlock[] {
  const { tickets, flight } = proposal;
  if (!tickets) return [];

  const legField = (label: string, leg: FlightLeg) => ({
    type: 'mrkdwn' as const,
    text:
      `*${label}* · ${leg.date}\n*${leg.from} → ${leg.to}*\n` +
      `${flight?.flightNumber ?? ''} · ${leg.departs} → ${leg.arrives}${leg.arrivesNextDay ? ' (+1)' : ''}`,
  });

  const blocks: KnownBlock[] = [
    { type: 'header', text: { type: 'plain_text', text: ':ticket: Your tickets', emoji: true } },
  ];
  if (tickets.flight) {
    blocks.push(
      { type: 'section', fields: [legField('Outbound', tickets.flight.outbound), legField('Return', tickets.flight.inbound)] },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text:
              `Booking code *${tickets.flight.recordLocator}* · seats ${tickets.flight.seats.join(', ')} · ` +
              `e-tickets ${tickets.flight.ticketNumbers.join(', ')}`,
          },
        ],
      },
    );
  }
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text:
        `:hotel: *Hotel voucher* · ${proposal.stay.name}\nConfirmation *${tickets.stay.confirmationCode}* · ` +
        `check-in ${tickets.stay.checkIn} from ${tickets.stay.checkInTime} · check-out ${tickets.stay.checkOut} by ${tickets.stay.checkOutTime}`,
    },
  });
  return blocks;
}

function buildDestinationBlocks(destinations: DestinationCardView[]): KnownBlock[] {
  const cards: KnownBlock[] = destinations.slice(0, MAX_DESTINATION_CARDS).map((destination, index) => ({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text:
        `*${destination.name}*, ${destination.country}  ·  _${destination.region}_\n` +
        `*${usd(destination.dailyCostUsd)}*/day · ${destination.budgetTier} · best in ${formatMonths(destination.bestMonths)}\n` +
        destination.tags.slice(0, 3).map((tag) => `\`${tag}\``).join(' '),
    },
    accessory: {
      type: 'button',
      action_id: `${QUICK_REPLY_ACTION_PREFIX}plan_${index}`,
      text: { type: 'plain_text', text: 'Plan this trip' },
      value: JSON.stringify({ text: `Plan a trip to ${destination.name}` } satisfies QuickReplyValue),
    },
  }));
  return [{ type: 'divider' }, ...cards];
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
    ],
  };
}

function describeFlightField(proposal: ProposalView) {
  const { flight } = proposal;
  if (!flight) return { type: 'mrkdwn' as const, text: '*:airplane: Flight*\nNot included' };
  const stops = flight.stops === 0 ? 'Direct' : `${flight.stops} stop`;
  return {
    type: 'mrkdwn' as const,
    text:
      `*:airplane: Flight*\n${flight.airline} ${flight.flightNumber}\n` +
      `${stops} · ${flight.durationHours}h · departs ${flight.departTime}\n` +
      `${usd(flight.priceUsdPerTraveler)} × ${proposal.travelers} = *${usd(proposal.costs.flightsUsd)}*`,
  };
}

function describeStayField(proposal: ProposalView) {
  const { stay } = proposal;
  const rooms = stay.rooms === 1 ? '1 room' : `${stay.rooms} rooms`;
  return {
    type: 'mrkdwn' as const,
    text:
      `*:hotel: Stay*\n${stay.name} · ★ ${stay.rating}\n` +
      `${usd(stay.nightlyRateUsd)}/night × ${proposal.nights} × ${rooms}\n= *${usd(proposal.costs.stayUsd)}*`,
  };
}

function describeStatus(proposal: ProposalView): string {
  const statusLine = STATUS_LINES[proposal.status];
  if (proposal.status === 'confirmed' && proposal.bookingRef) return `${statusLine} · Reference *${proposal.bookingRef}*`;
  if (proposal.status === 'proposed') return `${statusLine} · or reply "confirm" / "cancel"`;
  return statusLine;
}

function describeProposal(proposal: ProposalView): string {
  const flight = proposal.flight ? ` with ${proposal.flight.airline} flights` : '';
  return (
    `Proposed trip: ${proposal.destinationName}, ${proposal.country}, ${proposal.startDate} → ${proposal.endDate}, ` +
    `${pluralTravelers(proposal.travelers)}, ${proposal.stay.name}${flight}, total ${usd(proposal.estimatedTotalUsd)}. ` +
    'Reply "confirm" or "cancel".'
  );
}

function formatMonths(months: number[]): string {
  const names = [...months].sort((a, b) => a - b).map((month) => MONTH_NAMES[month - 1] ?? '');
  return names.length <= 4 ? names.join(', ') : `${names.slice(0, 4).join(', ')} +${names.length - 4}`;
}

function usd(amount: number): string {
  return `$${amount.toLocaleString('en-US')}`;
}

function pluralTravelers(travelers: number): string {
  return `${travelers} traveler${travelers === 1 ? '' : 's'}`;
}
