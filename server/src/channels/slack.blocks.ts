import type { KnownBlock } from '@slack/types';
import { z } from 'zod';
import type { ChatMessage, ProposalStatus, ProposalView } from '@app/shared';

export const CONFIRM_ACTION_ID = 'proposal_confirm';
export const CANCEL_ACTION_ID = 'proposal_cancel';
export const QUICK_REPLY_ACTION_PREFIX = 'quick_reply_';

export const THREAD_HINT = 'Reply in this thread to continue. A new direct message starts a new chat.';

const STATUS_LINES: Record<ProposalStatus, string> = {
  proposed: ':large_yellow_circle: *Proposal, not booked yet*',
  confirmed: ':white_check_mark: *Booked*',
  cancelled: ':x: *Cancelled*, nothing was booked',
  superseded: ':leftwards_arrow_with_hook: *Replaced by a newer proposal*',
};

export const ProposalActionValueSchema = z.object({
  conversationId: z.string(),
  proposalId: z.string(),
  threadTs: z.string(),
});

export const QuickReplyValueSchema = z.object({ threadTs: z.string(), text: z.string().min(1) });

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
  actionValue: Omit<ProposalActionValue, 'proposalId'>,
  options: { showThreadHint: boolean },
): SlackMessageContent {
  const text = reply.error ? describeError(reply) : toSlackMrkdwn(reply.text);
  const blocks: KnownBlock[] = [{ type: 'section', text: { type: 'mrkdwn', text } }];

  if (reply.proposal) {
    blocks.push(...buildProposalBlocks(reply.proposal, { ...actionValue, proposalId: reply.proposal.id }));
  }
  if (reply.quickReplies?.length) {
    blocks.push(buildQuickReplyBlock(reply.quickReplies, actionValue.threadTs));
  }
  if (options.showThreadHint) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: THREAD_HINT }] });
  }

  return { text: reply.proposal ? `${text}\n\n${describeProposal(reply.proposal)}` : text, blocks };
}

export function buildProposalBlocks(proposal: ProposalView, actionValue: ProposalActionValue): KnownBlock[] {
  const blocks: KnownBlock[] = [
    { type: 'divider' },
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
      elements: [{ type: 'mrkdwn', text: `Demo flight data · <${proposal.flight.compareUrl}|Compare real prices on Google Flights>` }],
    });
  }

  blocks.push(
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `*Total ${usd(proposal.estimatedTotalUsd)}* · ${proposal.paymentMethod}\n` +
          `Plus about ${usd(proposal.dailyBudgetUsd)} per person per day for food and activities (not charged).`,
      },
    },
    { type: 'context', elements: [{ type: 'mrkdwn', text: describeStatus(proposal) }] },
  );

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

function buildQuickReplyBlock(quickReplies: string[], threadTs: string): KnownBlock {
  return {
    type: 'actions',
    elements: quickReplies.map((text, index) => ({
      type: 'button',
      action_id: `${QUICK_REPLY_ACTION_PREFIX}${index}`,
      text: { type: 'plain_text', text },
      value: JSON.stringify({ threadTs, text } satisfies QuickReplyValue),
    })),
  };
}

function describeFlightField(proposal: ProposalView) {
  const { flight } = proposal;
  if (!flight) return { type: 'mrkdwn' as const, text: '*:airplane: Flight*\nNot included' };
  const stops = flight.stops === 0 ? 'Direct' : `${flight.stops} stop`;
  return {
    type: 'mrkdwn' as const,
    text:
      `*:airplane: Flight (demo)*\n${flight.airline} ${flight.flightNumber}\n` +
      `${flight.originAirport} → ${flight.destinationAirport} · ${stops} · ${flight.durationHours}h · ${flight.departTime}\n` +
      `${usd(flight.priceUsdPerTraveler)} × ${proposal.travelers} = ${usd(proposal.costs.flightsUsd)}`,
  };
}

function describeStayField(proposal: ProposalView) {
  const { stay } = proposal;
  const rooms = stay.rooms === 1 ? '1 room' : `${stay.rooms} rooms`;
  return {
    type: 'mrkdwn' as const,
    text:
      `*:hotel: Stay*\n${stay.name} · ★ ${stay.rating}\n` +
      `${usd(stay.nightlyRateUsd)}/night × ${proposal.nights} × ${rooms}\n= ${usd(proposal.costs.stayUsd)}`,
  };
}

function describeStatus(proposal: ProposalView): string {
  const statusLine = STATUS_LINES[proposal.status];
  if (proposal.status === 'confirmed' && proposal.bookingRef) {
    return `${statusLine} · Reference *${proposal.bookingRef}* · demo booking, no real payment`;
  }
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

function describeError(reply: ChatMessage): string {
  return `:warning: ${reply.text}`;
}

function usd(amount: number): string {
  return `$${amount.toLocaleString('en-US')}`;
}

function pluralTravelers(travelers: number): string {
  return `${travelers} traveler${travelers === 1 ? '' : 's'}`;
}
