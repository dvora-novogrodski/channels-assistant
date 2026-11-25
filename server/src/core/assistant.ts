import { randomUUID } from 'node:crypto';
import type { ChatMessage, ErrorKind, ProposalView, ResolveProposalResponse } from '@app/shared';
import { NotFoundError } from './errors.js';
import { LlmError, type Llm, type LlmMessage, type LlmReply } from './llm/types.js';
import { applyDecision, parseDecision, type ProposalDecision } from './proposals.js';
import type { Conversation, ConversationStore, Proposal, StoredMessage, User, UserPreferences } from './store.js';
import { executeToolCall, toolSpecs, type ToolContext, type ToolEffect } from './tools.js';

export const MAX_TOOL_STEPS = 6;
export const HISTORY_WINDOW = 24;
export const MAX_QUICK_REPLIES = 3;
export const MAX_QUICK_REPLY_LENGTH = 40;
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
}

class TurnLimitError extends Error {}

export class TripAssistant {
  private readonly store: ConversationStore;
  private readonly llm: Llm;
  private readonly now: () => Date;
  private readonly demoFailures: boolean;

  constructor({ store, llm, now = () => new Date(), demoFailures = false }: AssistantDependencies) {
    this.store = store;
    this.llm = llm;
    this.now = now;
    this.demoFailures = demoFailures;
  }

  async handleMessage(userId: string, conversationId: string, text: string): Promise<TurnResult> {
    const conversation = this.store.getConversation(userId, conversationId);
    if (conversation.busy) return { reply: this.errorReply('busy') };

    const decision = parseDecision(text);
    const pendingProposal = findPendingProposal(conversation);
    if (decision && pendingProposal) {
      const reply = this.resolve(userId, conversation, pendingProposal, decision, text);
      return { reply, updatedProposal: { ...pendingProposal } };
    }

    conversation.busy = true;
    try {
      return await this.runTurn(userId, conversation, text);
    } catch (error) {
      return { reply: this.errorReply(toErrorKind(error)) };
    } finally {
      conversation.busy = false;
    }
  }

  resolveProposal(
    userId: string,
    conversationId: string,
    proposalId: string,
    decision: ProposalDecision,
  ): ResolveProposalResponse {
    const conversation = this.store.getConversation(userId, conversationId);
    const proposal = conversation.proposals.find(({ id }) => id === proposalId);
    if (!proposal) throw new NotFoundError('Proposal not found');
    if (conversation.busy) return { proposal: { ...proposal }, reply: this.errorReply('busy') };

    const reply = this.resolve(userId, conversation, proposal, decision);
    return { proposal: { ...proposal }, reply };
  }

  private resolve(
    userId: string,
    conversation: Conversation,
    proposal: Proposal,
    decision: ProposalDecision,
    typedText?: string,
  ): ChatMessage {
    const outcome = applyDecision(this.store.getUser(userId), proposal, decision, this.now());
    const reply = this.message('assistant', outcome.text);
    if (!outcome.changed) return withoutProposalId(reply);

    // Recorded as a user/assistant pair so the model knows the outcome and the history keeps alternating roles.
    const buttonNote = `(I pressed ${decision === 'confirm' ? 'Confirm' : 'Cancel'} on the ${proposal.destinationName} proposal.)`;
    conversation.llmHistory.push(
      { role: 'user', text: typedText ?? buttonNote },
      { role: 'assistant', text: outcome.text, toolCalls: [] },
    );
    if (typedText) this.store.appendMessage(conversation, this.message('user', typedText));
    this.store.appendMessage(conversation, reply);
    return withoutProposalId(reply);
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
    const effects: ToolEffect[] = [];

    const finalReply = await this.runToolLoop(working, effects, context);

    // Commit point: nothing from this turn is visible until every LLM call has succeeded.
    conversation.llmHistory = working;
    const { proposal, superseded } = applyEffects(conversation, context.user, effects);
    this.store.appendMessage(conversation, this.message('user', text));
    const { text: replyText, quickReplies } = extractQuickReplies(finalReply.text ?? defaultReplyText(proposal));
    const reply = { ...this.message('assistant', replyText, proposal?.id), quickReplies };
    this.store.appendMessage(conversation, reply);

    return {
      reply: { ...withoutProposalId(reply), proposal: proposal && { ...proposal } },
      updatedProposal: superseded && { ...superseded },
    };
  }

  private async runToolLoop(working: LlmMessage[], effects: ToolEffect[], context: ToolContext): Promise<LlmReply> {
    for (let step = 0; step < MAX_TOOL_STEPS; step++) {
      const reply = await this.llm.generate({
        system: buildSystemPrompt(context.today, context.user.preferences),
        messages: recentHistory(working),
        tools: toolSpecs,
      });
      working.push({ role: 'assistant', text: reply.text, toolCalls: reply.toolCalls, raw: reply.raw });
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

function applyEffects(conversation: Conversation, user: User, effects: ToolEffect[]) {
  for (const effect of effects) {
    if (effect.type === 'savePreferences') user.preferences = { ...user.preferences, ...effect.preferences };
  }

  const latest = effects.flatMap((effect) => (effect.type === 'propose' ? [effect.proposal] : [])).at(-1);
  if (!latest) return {};

  const superseded = findPendingProposal(conversation);
  if (superseded) superseded.status = 'superseded';
  conversation.proposals.push(latest);
  return { proposal: latest, superseded };
}

// The model ends replies with "Quick replies: a | b | c"; the line is stripped from the text and shown as chips/buttons.
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

// The window must start at a user text message: Gemini rejects a history that opens with a tool result.
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

function describePreferences(preferences: UserPreferences): string {
  const known = [
    preferences.homeAirport && `home airport ${preferences.homeAirport}`,
    preferences.travelers && `usually ${preferences.travelers} traveler(s)`,
    preferences.budgetTier && `${preferences.budgetTier} budget`,
    preferences.interests?.length && `likes ${preferences.interests.join(', ')}`,
  ].filter(Boolean);
  return known.length ? `Known about this user: ${known.join('; ')}. Use these as defaults.` : 'No saved preferences yet.';
}

function buildSystemPrompt(today: string, preferences: UserPreferences): string {
  return [
    'You are Travel Assistant: a warm, knowledgeable travel planner who helps people choose a destination and books trip packages (demo flight + stay) for them.',
    `Today is ${today}. Turn relative dates ("this week", "next month", "in spring") into concrete dates based on today.`,
    describePreferences(preferences),
    '',
    'Freedom: answer general travel questions from your own knowledge (itineraries, what to pack, food, culture, typical weather, getting around, safety tips). For visas and entry rules, give a short reminder to check official sources.',
    'Grounding: anything bookable comes only from tools. Destinations you can book, stays, flights and every price must come from tool results; never invent them. If a place is not in the catalog, say you cannot book it yet and suggest similar catalog destinations.',
    '',
    'Tools:',
    '- search_destinations to find options (use month for seasons, remember the southern hemisphere; sortBy "price" for cheapest).',
    '- get_destination before describing a place in detail or choosing a stay; it lists stays with their ids.',
    '- search_flights needs the user\'s departure airport (3-letter code). Flights are demo offers: say so, and always include the compareUrl as a Markdown link like [Compare real prices](url).',
    '- propose_trip once destination, start date, nights and travelers are known (use saved preferences as defaults). Include the flight when you know the departure airport and the user wants one.',
    '- save_preferences when the user mentions their home city/airport, usual group size, budget style or interests.',
    '',
    'Booking and payment: propose_trip does NOT book. The card it creates shows the total and the demo card on file (Visa •••• 4242); the user confirms with the button or by replying "confirm". Never ask for card details; if the user offers them, tell them not to share card details and that the demo card on file is used. Never say a trip is booked unless list_bookings shows it.',
    'If a tool returns an error, fix the arguments or explain the problem. If key details are missing, ask one short question.',
    '',
    'Style: friendly and specific, like a good travel agent. Use short paragraphs and bullet lists, bold destination names, prices as rough USD estimates. Aim for under 160 words unless the user asks for an itinerary or more detail.',
    `End every reply with one last line in exactly this format, with 2-3 short follow-ups the user might send next (max ${MAX_QUICK_REPLY_LENGTH} characters each): Quick replies: option one | option two | option three`,
  ].join('\n');
}
