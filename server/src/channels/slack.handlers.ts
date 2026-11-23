import type { KnownBlock } from '@slack/types';
import type { ProposalView } from '@app/shared';
import type { TripAssistant } from '../core/assistant.js';
import { NotFoundError } from '../core/errors.js';
import type { ProposalDecision } from '../core/proposals.js';
import type { ConversationStore } from '../core/store.js';
import {
  buildProposalBlocks,
  buildReplyContent,
  parseActionValue,
  type ProposalActionValue,
  type SlackMessageContent,
} from './slack.blocks.js';

export const THINKING_TEXT = '_Checking destinations…_';

export interface SlackChat {
  postMessage(message: { channel: string; thread_ts?: string; text: string; blocks?: KnownBlock[] }): Promise<{ ts?: string }>;
  update(message: { channel: string; ts: string; text: string; blocks?: KnownBlock[] }): Promise<unknown>;
}

export interface IncomingSlackMessage {
  channel: string;
  channelType: string;
  ts: string;
  threadTs?: string;
  user?: string;
  text?: string;
  subtype?: string;
  botId?: string;
}

export interface SlackButtonClick {
  userId: string;
  channel: string;
  decision: ProposalDecision;
  value?: string;
}

interface ProposalCardRef {
  channel: string;
  ts: string;
  replyContent: SlackMessageContent;
  actionValue: ProposalActionValue;
  status: ProposalView['status'];
}

interface SlackHandlerDependencies {
  store: ConversationStore;
  assistant: TripAssistant;
  log?: Pick<Console, 'warn' | 'error'>;
}

export function toSlackOwnerId(slackUserId: string): string {
  return `slack:${slackUserId}`;
}

export function toSlackConversationId(channel: string, threadTs: string): string {
  return `slack:${channel}:${threadTs}`;
}

export function createSlackHandlers({ store, assistant, log = console }: SlackHandlerDependencies) {
  const proposalCards = new Map<string, ProposalCardRef>();

  async function deliver(action: string, send: () => Promise<unknown>): Promise<void> {
    try {
      await send();
    } catch (error) {
      log.error(`Slack delivery failed (${action})`, error);
    }
  }

  async function refreshProposalCard(chat: SlackChat, proposal: ProposalView): Promise<void> {
    const card = proposalCards.get(proposal.id);
    if (!card) return;

    const [replySection] = card.replyContent.blocks;
    const proposalBlocks = buildProposalBlocks(proposal, card.actionValue);
    card.status = proposal.status;
    await deliver('update proposal card', () =>
      chat.update({
        channel: card.channel,
        ts: card.ts,
        text: card.replyContent.text,
        blocks: replySection ? [replySection, ...proposalBlocks] : proposalBlocks,
      }),
    );
  }

  async function handleMessage(message: IncomingSlackMessage, chat: SlackChat): Promise<void> {
    const text = message.text?.trim();
    if (message.subtype || message.botId || !message.user || !text) return;
    if (message.channelType !== 'im') return;
    if (!store.markEventSeen(`slack:${message.channel}:${message.ts}`)) return;

    const threadTs = message.threadTs ?? message.ts;
    const ownerId = toSlackOwnerId(message.user);
    const conversationId = toSlackConversationId(message.channel, threadTs);
    store.getOrCreateConversation(ownerId, conversationId);

    let placeholderTs: string | undefined;
    await deliver('post thinking placeholder', async () => {
      placeholderTs = (await chat.postMessage({ channel: message.channel, thread_ts: threadTs, text: THINKING_TEXT })).ts;
    });

    const { reply, updatedProposal } = await assistant.handleMessage(ownerId, conversationId, text);
    const content = buildReplyContent(reply, { conversationId, threadTs }, { showThreadHint: !message.threadTs });

    let replyTs = placeholderTs;
    if (placeholderTs) {
      const ts = placeholderTs;
      await deliver('update reply', () => chat.update({ channel: message.channel, ts, ...content }));
    } else {
      await deliver('post reply', async () => {
        replyTs = (await chat.postMessage({ channel: message.channel, thread_ts: threadTs, ...content })).ts;
      });
    }

    if (reply.proposal && replyTs) {
      proposalCards.set(reply.proposal.id, {
        channel: message.channel,
        ts: replyTs,
        replyContent: content,
        actionValue: { conversationId, proposalId: reply.proposal.id, threadTs },
        status: reply.proposal.status,
      });
    }
    if (updatedProposal) await refreshProposalCard(chat, updatedProposal);
  }

  async function handleButtonClick(click: SlackButtonClick, chat: SlackChat): Promise<void> {
    const actionValue = parseActionValue(click.value);
    if (!actionValue) {
      log.warn('Ignoring Slack button with an invalid value');
      return;
    }

    const { conversationId, proposalId, threadTs } = actionValue;
    const postInThread = (text: string) =>
      deliver('post decision reply', () => chat.postMessage({ channel: click.channel, thread_ts: threadTs, text }));

    let result;
    try {
      result = assistant.resolveProposal(toSlackOwnerId(click.userId), conversationId, proposalId, click.decision);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      await postInThread('That proposal is no longer available. Ask me to prepare a new one.');
      return;
    }

    // Slack can deliver the same click twice; only announce a decision that actually changed the proposal.
    const statusBefore = proposalCards.get(proposalId)?.status;
    const changed = statusBefore !== result.proposal.status;
    if (changed) await refreshProposalCard(chat, result.proposal);
    if (result.reply.error || changed) await postInThread(result.reply.text);
  }

  return { handleMessage, handleButtonClick };
}
