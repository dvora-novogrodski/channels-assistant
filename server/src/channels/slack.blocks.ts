import type { KnownBlock } from '@slack/types';
import { z } from 'zod';
import type { ChatMessage, ProposalStatus, ProposalView } from '@app/shared';

export const CONFIRM_ACTION_ID = 'proposal_confirm';
export const CANCEL_ACTION_ID = 'proposal_cancel';

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

export type ProposalActionValue = z.infer<typeof ProposalActionValueSchema>;

export interface SlackMessageContent {
  text: string;
  blocks: KnownBlock[];
}

// Gemini replies in GitHub-style Markdown; Slack's mrkdwn uses *bold*, <url|label> links and no headings.
export function toSlackMrkdwn(markdown: string): string {
  return markdown
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
        text: `*${proposal.destinationName}, ${proposal.country}*\nStay only, flights not included`,
      },
      fields: [
        { type: 'mrkdwn', text: `*Dates*\n${proposal.startDate} → ${proposal.endDate}` },
        { type: 'mrkdwn', text: `*Nights*\n${proposal.nights}` },
        { type: 'mrkdwn', text: `*Travelers*\n${proposal.travelers}` },
        { type: 'mrkdwn', text: `*Estimated total*\n~$${proposal.estimatedTotalUsd.toLocaleString('en-US')}` },
      ],
    },
    { type: 'context', elements: [{ type: 'mrkdwn', text: describeStatus(proposal) }] },
  ];

  if (proposal.status === 'proposed') {
    const value = JSON.stringify(actionValue);
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          action_id: CONFIRM_ACTION_ID,
          style: 'primary',
          text: { type: 'plain_text', text: 'Confirm stay' },
          value,
        },
        {
          type: 'button',
          action_id: CANCEL_ACTION_ID,
          style: 'danger',
          text: { type: 'plain_text', text: 'Cancel' },
          value,
        },
      ],
    });
  }
  return blocks;
}

export function parseActionValue(value: string | undefined): ProposalActionValue | undefined {
  if (!value) return undefined;
  try {
    return ProposalActionValueSchema.parse(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function describeStatus(proposal: ProposalView): string {
  const statusLine = STATUS_LINES[proposal.status];
  if (proposal.status === 'confirmed' && proposal.bookingRef) {
    return `${statusLine} · Reference *${proposal.bookingRef}* · simulated, no payment taken`;
  }
  if (proposal.status === 'proposed') return `${statusLine} · or reply "confirm" / "cancel"`;
  return statusLine;
}

function describeProposal(proposal: ProposalView): string {
  return (
    `Proposed stay: ${proposal.destinationName}, ${proposal.country}, ${proposal.startDate} → ${proposal.endDate}, ` +
    `${proposal.travelers} traveler(s), ~$${proposal.estimatedTotalUsd}. Reply "confirm" or "cancel".`
  );
}

function describeError(reply: ChatMessage): string {
  return `:warning: ${reply.text}`;
}
