import type { KnownBlock } from '@slack/types';
import type { ChatMessage, ProposalView } from '@app/shared';
import type { TripAssistant } from '../core/assistant.js';
import { NotFoundError } from '../core/errors.js';
import type { ProposalDecision } from '../core/proposals.js';
import type { ConversationStore } from '../core/store.js';
import {
  BOOKING_STEPS,
  buildBookingProgressContent,
  buildNewTripContent,
  buildReplyContent,
  parseActionValue,
  parseQuickReplyValue,
  toSlackMrkdwn,
} from './slack.blocks.js';

export const THINKING_TEXT = '_Planning your trip…_';
export const DELIVERY_FAILED_TEXT =
  ":warning: I couldn't show my last answer here. Please send your message again, or ask for a shorter answer.";
export const BOOKING_STEP_MS = 900;
const MAX_TRACKED_CARDS = 500;
const NEW_TRIP_PATTERN = /^(new trip|start over|new chat)[.!]*$/i;

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

export interface SlackActionClick {
  userId: string;
  channel: string;
  actionTs: string;
  value?: string;
}

interface ProposalCardRef {
  channel: string;
  ts: string;
  conversationId: string;
  reply: ChatMessage;
  status: ProposalView['status'];
}

interface SlackHandlerDependencies {
  store: ConversationStore;
  assistant: TripAssistant;
  log?: Pick<Console, 'warn' | 'error'>;
  pause?: (milliseconds: number) => Promise<void>;
}

export function toSlackOwnerId(slackUserId: string): string {
  return `slack:${slackUserId}`;
}

export function toSlackConversationId(channel: string, sessionTs: string): string {
  return `slack:${channel}:${sessionTs}`;
}

const defaultPause = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

// The whole DM is one flat chat. A "session" (one trip conversation) lasts until the user asks for a new trip;
// it starts at the timestamp of its first message, which makes every session id unique.
export function createSlackHandlers({ store, assistant, log = console, pause = defaultPause }: SlackHandlerDependencies) {
  const proposalCards = new Map<string, ProposalCardRef>();
  const currentSessions = new Map<string, string>();

  async function deliver(action: string, send: () => Promise<unknown>): Promise<boolean> {
    try {
      await send();
      return true;
    } catch (error) {
      log.error(`Slack delivery failed (${action})`, error);
      return false;
    }
  }

  function currentSession(channel: string, ts: string): { sessionTs: string; isNew: boolean } {
    const existing = currentSessions.get(channel);
    if (existing) return { sessionTs: existing, isNew: false };
    currentSessions.set(channel, ts);
    return { sessionTs: ts, isNew: true };
  }

  async function refreshProposalCard(chat: SlackChat, proposal: ProposalView): Promise<void> {
    const card = proposalCards.get(proposal.id);
    if (!card) return;

    card.status = proposal.status;
    card.reply = { ...card.reply, proposal };
    const content = buildReplyContent(card.reply, card.conversationId, { showSessionHint: false });
    await deliver('update proposal card', () => chat.update({ channel: card.channel, ts: card.ts, ...content }));
  }

  async function showBookingProgress(chat: SlackChat, card: ProposalCardRef): Promise<void> {
    for (const [index] of BOOKING_STEPS.entries()) {
      const content = buildBookingProgressContent(card.reply, index);
      await deliver('update booking progress', () => chat.update({ channel: card.channel, ts: card.ts, ...content }));
      await pause(BOOKING_STEP_MS);
    }
  }

  function rememberProposalCard(proposalId: string, card: ProposalCardRef): void {
    proposalCards.set(proposalId, card);
    if (proposalCards.size <= MAX_TRACKED_CARDS) return;
    const oldest = proposalCards.keys().next().value;
    if (oldest !== undefined) proposalCards.delete(oldest);
  }

  async function startNewTrip(channel: string, ts: string, chat: SlackChat): Promise<void> {
    currentSessions.set(channel, ts);
    await deliver('post new trip', () => chat.postMessage({ channel, ...buildNewTripContent() }));
  }

  async function runTurn(channel: string, ts: string, slackUserId: string, text: string, chat: SlackChat): Promise<void> {
    const { sessionTs, isNew } = currentSession(channel, ts);
    const ownerId = toSlackOwnerId(slackUserId);
    const conversationId = toSlackConversationId(channel, sessionTs);
    store.getOrCreateConversation(ownerId, conversationId);

    let placeholderTs: string | undefined;
    await deliver('post thinking placeholder', async () => {
      placeholderTs = (await chat.postMessage({ channel, text: THINKING_TEXT })).ts;
    });

    const { reply, updatedProposal } = await assistant.handleMessage(ownerId, conversationId, text);
    const content = buildReplyContent(reply, conversationId, { showSessionHint: isNew });

    let replyTs = placeholderTs;
    const delivered = placeholderTs
      ? await deliver('update reply', () => chat.update({ channel, ts: placeholderTs ?? '', ...content }))
      : await deliver('post reply', async () => {
          replyTs = (await chat.postMessage({ channel, ...content })).ts;
        });

    if (!delivered) {
      await notifyDeliveryFailure(chat, channel, placeholderTs);
      return;
    }
    if (reply.proposal && replyTs) {
      rememberProposalCard(reply.proposal.id, {
        channel,
        ts: replyTs,
        conversationId,
        reply,
        status: reply.proposal.status,
      });
    }
    if (updatedProposal) await refreshProposalCard(chat, updatedProposal);
  }

  // A rejected rich message (e.g. invalid blocks) must not leave the user staring at the placeholder.
  async function notifyDeliveryFailure(chat: SlackChat, channel: string, placeholderTs: string | undefined) {
    const shown = placeholderTs
      ? await deliver('replace placeholder with failure notice', () =>
          chat.update({ channel, ts: placeholderTs, text: DELIVERY_FAILED_TEXT, blocks: [] }),
        )
      : false;
    if (!shown) await deliver('post failure notice', () => chat.postMessage({ channel, text: DELIVERY_FAILED_TEXT }));
  }

  async function handleMessage(message: IncomingSlackMessage, chat: SlackChat): Promise<void> {
    const text = message.text?.trim();
    if (message.subtype || message.botId || !message.user || !text) return;
    if (message.channelType !== 'im') return;
    if (!store.markEventSeen(`slack:${message.channel}:${message.ts}`)) return;

    if (NEW_TRIP_PATTERN.test(text)) {
      await startNewTrip(message.channel, message.ts, chat);
      return;
    }
    await runTurn(message.channel, message.ts, message.user, text, chat);
  }

  async function handleQuickReply(click: SlackActionClick, chat: SlackChat): Promise<void> {
    const quickReply = parseQuickReplyValue(click.value);
    if (!quickReply) {
      log.warn('Ignoring Slack quick reply with an invalid value');
      return;
    }
    if (!store.markEventSeen(`slack-action:${click.actionTs}`)) return;

    await deliver('echo quick reply', () =>
      chat.postMessage({ channel: click.channel, text: `:speech_balloon: _${toSlackMrkdwn(quickReply.text)}_` }),
    );
    await runTurn(click.channel, click.actionTs, click.userId, quickReply.text, chat);
  }

  async function handleNewTrip(click: SlackActionClick, chat: SlackChat): Promise<void> {
    if (!store.markEventSeen(`slack-action:${click.actionTs}`)) return;
    await startNewTrip(click.channel, click.actionTs, chat);
  }

  async function handleButtonClick(click: SlackButtonClick, chat: SlackChat): Promise<void> {
    const actionValue = parseActionValue(click.value);
    if (!actionValue) {
      log.warn('Ignoring Slack button with an invalid value');
      return;
    }

    const { conversationId, proposalId } = actionValue;
    const postToChat = (text: string) =>
      deliver('post decision reply', () => chat.postMessage({ channel: click.channel, text }));

    let result;
    try {
      result = assistant.resolveProposal(toSlackOwnerId(click.userId), conversationId, proposalId, click.decision);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      await postToChat('That proposal is no longer available. Ask me to prepare a new one.');
      return;
    }

    // Slack can deliver the same click twice; only announce a decision that actually changed the proposal.
    const card = proposalCards.get(proposalId);
    const changed = card?.status !== result.proposal.status;
    if (changed && card && result.proposal.status === 'confirmed') await showBookingProgress(chat, card);
    if (changed) await refreshProposalCard(chat, result.proposal);
    if (result.reply.error || changed) await postToChat(result.reply.text);
  }

  return { handleMessage, handleButtonClick, handleQuickReply, handleNewTrip };
}
