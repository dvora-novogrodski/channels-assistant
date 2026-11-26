import { randomUUID } from 'node:crypto';
import {
  type ChatMessage,
  type DestinationCardView,
  type ErrorKind,
  type ProposalDecision,
  type ProposalView,
  type ResolveProposalResponse,
} from '@app/shared';
import { NotFoundError } from './errors.js';
import { LlmError, type Llm, type LlmMessage, type LlmReply } from './llm/types.js';
import { MAX_QUICK_REPLY_LENGTH, buildSystemPrompt } from './prompt.js';
import { decide, parseDecision } from './proposals.js';
import type { Conversation, ConversationStore, Proposal, StoredMessage, UserPreferences } from './store.js';
import { executeToolCall, toolSpecs, type ToolContext, type ToolEffect } from './tools.js';
import { TurnLock } from './turnLock.js';

export const MAX_TOOL_STEPS = 6;
export const HISTORY_WINDOW = 24;
export const MAX_QUICK_REPLIES = 3;
export const DEMO_FAILURE_TRIGGER = 'simulate failure';

const ERROR_REPLIES: Record<ErrorKind, { text: string; retryable: boolean }> = {
  rate_limit: { text: 'The AI service is busy right now (free-tier limit). Please try again in a minute.', retryable: true },
  unavailable: { text: "I couldn't reach the AI service, so your message wasn't saved. Please try again.", retryable: true },
  blocked: { text: "I can't help with that request. Try rephrasing it.", retryable: false },
  busy: { text: "I'm still working on your previous message. Please wait for my reply.", retryable: true },
  internal: { text: 'Something went wrong on my side, so your message wasn\'t saved. Please try again.', retryable: true },
};

export interface TurnResult {
  reply: ChatMessage;
  updatedProposal?: ProposalView;
}

export interface AssistantDependencies {
  store: ConversationStore;
  llm: Llm;
  now?: () => Date;
  demoFailures?: boolean;
  turnLock?: TurnLock;
}

interface DecisionSource {
  typedText?: string;
  paymentMethodId?: string;
}

class TurnLimitError extends Error {}

export class TripAssistant {
  private readonly store: ConversationStore;
  private readonly llm: Llm;
  private readonly now: () => Date;
  private readonly demoFailures: boolean;
  private readonly turnLock: TurnLock;

  constructor({ store, llm, now = () => new Date(), demoFailures = false, turnLock = new TurnLock() }: AssistantDependencies) {
    this.store = store;
    this.llm = llm;
    this.now = now;
    this.demoFailures = demoFailures;
    this.turnLock = turnLock;
  }

  async handleMessage(userId: string, conversationId: string, text: string): Promise<TurnResult> {
    const conversation = this.store.getConversation(userId, conversationId);
    if (!this.turnLock.tryAcquire(conversationId)) return { reply: this.errorReply('busy') };

    try {
      const decision = parseDecision(text);
      const pendingProposal = findPendingProposal(conversation);
      if (decision && pendingProposal) {
        const { reply, proposal } = this.resolve(userId, conversationId, pendingProposal, decision, { typedText: text });
        return { reply, updatedProposal: proposal };
      }
      return await this.runTurn(userId, conversation, text);
    } catch (error) {
      return { reply: this.errorReply(toErrorKind(error)) };
    } finally {
      this.turnLock.release(conversationId);
    }
  }

  resolveProposal(
    userId: string,
    conversationId: string,
    proposalId: string,
    decision: ProposalDecision,
    paymentMethodId?: string,
  ): ResolveProposalResponse {
    const conversation = this.store.getConversation(userId, conversationId);
    const proposal = conversation.proposals.find(({ id }) => id === proposalId);
    if (!proposal) throw new NotFoundError('Proposal not found');
    if (this.turnLock.isHeld(conversationId)) return { proposal, reply: this.errorReply('busy'), changed: false };

    return this.resolve(userId, conversationId, proposal, decision, { paymentMethodId });
  }

  private resolve(
    userId: string,
    conversationId: string,
    proposal: Proposal,
    decision: ProposalDecision,
    { typedText, paymentMethodId }: DecisionSource,
  ): ResolveProposalResponse {
    const outcome = decide(proposal, decision, this.now(), paymentMethodId);
    const reply = this.message('assistant', outcome.text);
    if (!outcome.changed) return { reply: withoutProposalId(reply), proposal: outcome.proposal, changed: false };

    const typedMessages = typedText ? [this.message('user', typedText)] : [];
    this.store.commit(userId, conversationId, {
      llmMessages: [
        { role: 'user', text: typedText ?? describeButtonPress(decision, proposal) },
        { role: 'assistant', text: outcome.text, toolCalls: [] },
      ],
      messages: [...typedMessages, reply],
      proposals: [outcome.proposal],
      booking: outcome.booking,
    });
    return { reply: withoutProposalId(reply), proposal: outcome.proposal, changed: true };
  }

  private async runTurn(userId: string, conversation: Conversation, text: string): Promise<TurnResult> {
    if (this.demoFailures && text.trim().toLowerCase() === DEMO_FAILURE_TRIGGER) {
      throw new LlmError('unavailable', 'Simulated outage (DEMO_FAILURES)');
    }

    const context: ToolContext = {
      user: this.store.getUser(userId),
      conversation,
      today: this.now().toISOString().slice(0, 10),
    };
    const working: LlmMessage[] = [...conversation.llmHistory, { role: 'user', text }];
    const turnStart = conversation.llmHistory.length;
    const effects: ToolEffect[] = [];

    const finalReply = await this.runToolLoop(working, effects, context);

    const turnMessages = working.slice(turnStart);
    const { proposal, superseded, preferences } = summarizeEffects(conversation, effects);
    const { text: extractedText, quickReplies } = extractQuickReplies(finalReply.text ?? '');
    const replyText = extractedText || defaultReplyText(proposal);
    const destinations = proposal ? undefined : latestSuggestedDestinations(effects);
    const reply = { ...this.message('assistant', replyText, proposal?.id), quickReplies, destinations };

    this.store.commit(userId, conversation.id, {
      llmMessages: turnMessages,
      messages: [this.message('user', text), reply],
      proposals: [superseded, proposal].filter((item): item is Proposal => item !== undefined),
      preferences,
    });

    return { reply: { ...withoutProposalId(reply), proposal }, updatedProposal: superseded };
  }

  private async runToolLoop(working: LlmMessage[], effects: ToolEffect[], context: ToolContext): Promise<LlmReply> {
    for (let step = 0; step < MAX_TOOL_STEPS; step++) {
      const reply = await this.llm.generate({
        system: buildSystemPrompt(context.today, context.user.preferences),
        messages: recentHistory(working),
        tools: toolSpecs,
      });
      working.push({ role: 'assistant', text: reply.text, toolCalls: reply.toolCalls, providerParts: reply.providerParts });
      if (reply.toolCalls.length === 0) return reply;

      const executions = reply.toolCalls.map((call) => executeToolCall(call, context));
      working.push({ role: 'tool', results: executions.map(({ result }) => result) });
      effects.push(...executions.flatMap(({ effect }) => (effect ? [effect] : [])));
    }
    throw new TurnLimitError(`No final answer after ${MAX_TOOL_STEPS} tool steps`);
  }

  private message(role: StoredMessage['role'], text: string, proposalId?: string): StoredMessage {
    return { id: randomUUID(), role, text, createdAt: this.now().toISOString(), proposalId };
  }

  private errorReply(kind: ErrorKind): ChatMessage {
    const { text, retryable } = ERROR_REPLIES[kind];
    return { id: randomUUID(), role: 'assistant', text, createdAt: this.now().toISOString(), error: { kind, retryable } };
  }
}

function findPendingProposal(conversation: Conversation): Proposal | undefined {
  return conversation.proposals.find(({ status }) => status === 'proposed');
}

interface TurnEffects {
  proposal?: Proposal;
  superseded?: Proposal;
  preferences?: UserPreferences;
}

function summarizeEffects(conversation: Conversation, effects: ToolEffect[]): TurnEffects {
  const preferences = mergePreferenceEffects(effects);
  const proposal = effects.flatMap((effect) => (effect.type === 'propose' ? [effect.proposal] : [])).at(-1);
  if (!proposal) return { preferences };

  const pending = findPendingProposal(conversation);
  const superseded: Proposal | undefined = pending && { ...pending, status: 'superseded' };
  return { proposal, superseded, preferences };
}

function mergePreferenceEffects(effects: ToolEffect[]): UserPreferences | undefined {
  const saved = effects.flatMap((effect) => (effect.type === 'savePreferences' ? [effect.preferences] : []));
  return saved.length ? Object.assign({}, ...saved) : undefined;
}

function describeButtonPress(decision: ProposalDecision, proposal: Proposal): string {
  return `(I pressed ${decision === 'confirm' ? 'Confirm' : 'Cancel'} on the ${proposal.destinationName} proposal.)`;
}

function latestSuggestedDestinations(effects: ToolEffect[]): DestinationCardView[] | undefined {
  const latest = effects.flatMap((effect) => (effect.type === 'suggestDestinations' ? [effect.destinations] : [])).at(-1);
  return latest?.length ? latest : undefined;
}

export function extractQuickReplies(text: string): { text: string; quickReplies?: string[] } {
  const match = text.match(/\n*\s*\**quick replies:?\**:?\s*(.+)\s*$/i);
  if (!match?.[1]) return { text };

  const quickReplies = match[1]
    .split('|')
    .map((option) => option.replace(/^["'\s*-]+|["'\s*]+$/g, '').trim())
    .filter((option) => option.length > 0 && option.length <= MAX_QUICK_REPLY_LENGTH)
    .slice(0, MAX_QUICK_REPLIES);
  return { text: text.slice(0, match.index).trimEnd(), quickReplies: quickReplies.length ? quickReplies : undefined };
}

export function recentHistory(messages: LlmMessage[]): LlmMessage[] {
  const windowStart = Math.max(0, messages.length - HISTORY_WINDOW);
  const firstUserIndex = messages.findIndex((message, index) => index >= windowStart && message.role === 'user');
  return firstUserIndex === -1 ? messages.slice(windowStart) : messages.slice(firstUserIndex);
}

function toErrorKind(error: unknown): ErrorKind {
  if (error instanceof LlmError) {
    console.warn(`LLM call failed (${error.kind}): ${error.message}`);
    return error.kind === 'bad_request' ? 'internal' : error.kind;
  }
  console.error('Assistant turn failed', error);
  return 'internal';
}

function defaultReplyText(proposal: Proposal | undefined): string {
  return proposal ? 'Here is the proposed trip. Confirm to book it, or tell me what to change.' : 'Done.';
}

function withoutProposalId({ proposalId: _proposalId, ...message }: StoredMessage): ChatMessage {
  return message;
}
