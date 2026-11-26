import type { KnownBlock } from '@slack/types';
import {
  BOOKING_STEPS,
  BOOKING_STEP_MS,
  type ChatMessage,
  type ProposalDecision,
  type ProposalView,
  type ResolveProposalResponse,
} from '@app/shared';
import type { TripAssistant } from '../core/assistant.js';
import { NotFoundError } from '../core/errors.js';
import type { ConversationStore } from '../core/store.js';
import {
  buildBookingProgressContent,
  buildNewTripContent,
  buildReplyContent,
  parseActionValue,
  parseQuickReplyValue,
  toSlackMrkdwn,
  type SlackMessageContent,
} from './slack.blocks.js';

export const THINKING_TEXT = '_Planning your trip…_';
export const DELIVERY_FAILED_TEXT =
  ":warning: I couldn't show my last answer here. Please send your message again, or ask for a shorter answer.";
const PROPOSAL_UNAVAILABLE_TEXT = 'That proposal is no longer available. Ask me to prepare a new one.';
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
}

interface DirectMessage {
  channel: string;
  ts: string;
  user: string;
  text: string;
}

interface Delivery {
  delivered: boolean;
  ts?: string;
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

function toDirectMessage(message: IncomingSlackMessage): DirectMessage | undefined {
  const text = message.text?.trim();
  const isFromBotOrSystem = Boolean(message.subtype || message.botId);
  if (isFromBotOrSystem || message.channelType !== 'im' || !message.user || !text) return undefined;
  return { channel: message.channel, ts: message.ts, user: message.user, text };
}

function messageEventKey({ channel, ts }: DirectMessage): string {
  return `slack:${channel}:${ts}`;
}

function actionEventKey({ actionTs }: SlackActionClick): string {
  return `slack-action:${actionTs}`;
}

function rememberWithLimit<TKey, TValue>(map: Map<TKey, TValue>, key: TKey, value: TValue, limit: number): void {
  map.set(key, value);
  if (map.size <= limit) return;
  const oldest = map.keys().next();
  if (!oldest.done) map.delete(oldest.value);
}

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

  async function post(action: string, chat: SlackChat, message: Parameters<SlackChat['postMessage']>[0]): Promise<Delivery> {
    let ts: string | undefined;
    const delivered = await deliver(action, async () => {
      ts = (await chat.postMessage(message)).ts;
    });
    return { delivered, ts };
  }

  async function postText(action: string, chat: SlackChat, channel: string, text: string): Promise<void> {
    await post(action, chat, { channel, text });
  }

  async function updateCard(action: string, chat: SlackChat, card: ProposalCardRef, content: SlackMessageContent) {
    return deliver(action, () => chat.update({ channel: card.channel, ts: card.ts, ...content }));
  }

  function currentSession(channel: string, ts: string): { sessionTs: string; isNew: boolean } {
    const existing = currentSessions.get(channel);
    if (existing) return { sessionTs: existing, isNew: false };
    currentSessions.set(channel, ts);
    return { sessionTs: ts, isNew: true };
  }

  function isFirstDelivery(eventKey: string): boolean {
    return store.markEventSeen(eventKey);
  }

  function parseOrWarn<T>(parsed: T | undefined, description: string): T | undefined {
    if (!parsed) log.warn(`Ignoring Slack ${description} with an invalid value`);
    return parsed;
  }

  async function refreshProposalCard(chat: SlackChat, proposal: ProposalView): Promise<void> {
    const card = proposalCards.get(proposal.id);
    if (!card) return;
    card.reply = { ...card.reply, proposal };
    await updateCard('update proposal card', chat, card, buildReplyContent(card.reply, card.conversationId, { showSessionHint: false }));
  }

  async function showBookingProgress(chat: SlackChat, card: ProposalCardRef): Promise<void> {
    for (let step = 0; step < BOOKING_STEPS.length; step++) {
      await updateCard('update booking progress', chat, card, buildBookingProgressContent(card.reply, step));
      await pause(BOOKING_STEP_MS);
    }
  }

  function trackProposalCard(reply: ChatMessage, card: Omit<ProposalCardRef, 'reply'>): void {
    if (!reply.proposal) return;
    rememberWithLimit(proposalCards, reply.proposal.id, { ...card, reply }, MAX_TRACKED_CARDS);
  }

  async function startNewTrip(channel: string, ts: string, chat: SlackChat): Promise<void> {
    currentSessions.set(channel, ts);
    await post('post new trip', chat, { channel, ...buildNewTripContent() });
  }

  async function showReply(
    chat: SlackChat,
    channel: string,
    placeholderTs: string | undefined,
    content: SlackMessageContent,
  ): Promise<Delivery> {
    if (!placeholderTs) return post('post reply', chat, { channel, ...content });
    const delivered = await deliver('update reply', () => chat.update({ channel, ts: placeholderTs, ...content }));
    return { delivered, ts: placeholderTs };
  }

  async function notifyDeliveryFailure(chat: SlackChat, channel: string, placeholderTs: string | undefined) {
    const replacedPlaceholder =
      placeholderTs !== undefined &&
      (await deliver('replace placeholder with failure notice', () =>
        chat.update({ channel, ts: placeholderTs, text: DELIVERY_FAILED_TEXT, blocks: [] }),
      ));
    if (!replacedPlaceholder) await postText('post failure notice', chat, channel, DELIVERY_FAILED_TEXT);
  }

  async function runTurn(channel: string, ts: string, slackUserId: string, text: string, chat: SlackChat): Promise<void> {
    const { sessionTs, isNew } = currentSession(channel, ts);
    const ownerId = toSlackOwnerId(slackUserId);
    const conversationId = toSlackConversationId(channel, sessionTs);
    store.getOrCreateConversation(ownerId, conversationId);

    const placeholder = await post('post thinking placeholder', chat, { channel, text: THINKING_TEXT });
    const { reply, updatedProposal } = await assistant.handleMessage(ownerId, conversationId, text);
    const content = buildReplyContent(reply, conversationId, { showSessionHint: isNew });
    const shown = await showReply(chat, channel, placeholder.ts, content);

    if (!shown.delivered) {
      await notifyDeliveryFailure(chat, channel, placeholder.ts);
      return;
    }
    if (shown.ts) trackProposalCard(reply, { channel, ts: shown.ts, conversationId });
    if (updatedProposal) await refreshProposalCard(chat, updatedProposal);
  }

  function tryResolveProposal(
    click: SlackButtonClick,
    conversationId: string,
    proposalId: string,
  ): ResolveProposalResponse | undefined {
    try {
      return assistant.resolveProposal(toSlackOwnerId(click.userId), conversationId, proposalId, click.decision);
    } catch (error) {
      if (error instanceof NotFoundError) return undefined;
      throw error;
    }
  }

  async function showDecisionOnCard(chat: SlackChat, proposal: ProposalView): Promise<void> {
    const card = proposalCards.get(proposal.id);
    if (card && proposal.status === 'confirmed') await showBookingProgress(chat, card);
    await refreshProposalCard(chat, proposal);
  }

  async function handleMessage(message: IncomingSlackMessage, chat: SlackChat): Promise<void> {
    const directMessage = toDirectMessage(message);
    if (!directMessage || !isFirstDelivery(messageEventKey(directMessage))) return;

    const { channel, ts, user, text } = directMessage;
    if (NEW_TRIP_PATTERN.test(text)) return startNewTrip(channel, ts, chat);
    await runTurn(channel, ts, user, text, chat);
  }

  async function handleQuickReply(click: SlackActionClick, chat: SlackChat): Promise<void> {
    const quickReply = parseOrWarn(parseQuickReplyValue(click.value), 'quick reply');
    if (!quickReply || !isFirstDelivery(actionEventKey(click))) return;

    await postText('echo quick reply', chat, click.channel, `:speech_balloon: _${toSlackMrkdwn(quickReply.text)}_`);
    await runTurn(click.channel, click.actionTs, click.userId, quickReply.text, chat);
  }

  async function handleNewTrip(click: SlackActionClick, chat: SlackChat): Promise<void> {
    if (!isFirstDelivery(actionEventKey(click))) return;
    await startNewTrip(click.channel, click.actionTs, chat);
  }

  async function handleButtonClick(click: SlackButtonClick, chat: SlackChat): Promise<void> {
    const actionValue = parseOrWarn(parseActionValue(click.value), 'button');
    if (!actionValue) return;

    const result = tryResolveProposal(click, actionValue.conversationId, actionValue.proposalId);
    if (!result) return postText('post decision reply', chat, click.channel, PROPOSAL_UNAVAILABLE_TEXT);

    const { proposal, reply, changed } = result;
    if (changed) await showDecisionOnCard(chat, proposal);
    if (changed || reply.error) await postText('post decision reply', chat, click.channel, toSlackMrkdwn(reply.text));
  }

  return { handleMessage, handleButtonClick, handleQuickReply, handleNewTrip };
}
