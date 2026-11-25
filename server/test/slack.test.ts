import type { ActionsBlockElement, KnownBlock, SectionBlockAccessory } from '@slack/types';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CONFIRM_ACTION_ID,
  NEW_TRIP_ACTION_ID,
  SESSION_HINT,
  buildReplyContent,
  parseActionValue,
  toSlackMrkdwn,
} from '../src/channels/slack.blocks.js';
import {
  THINKING_TEXT,
  createSlackHandlers,
  type IncomingSlackMessage,
  type SlackChat,
} from '../src/channels/slack.handlers.js';
import { loadConfig } from '../src/config.js';
import { TripAssistant } from '../src/core/assistant.js';
import { LlmError } from '../src/core/llm/types.js';
import { InMemoryConversationStore } from '../src/core/store.js';
import { sampleProposal } from './fixtures.js';
import { ScriptedLlm, textReply, toolReply } from './scriptedLlm.js';

const CHANNEL = 'D123';
const LISBON_BOOKING = { destinationId: 'lisbon-pt', startDate: '2027-05-12', nights: 5, travelers: 2 };
const SILENT_LOG = { warn: () => {}, error: () => {} };

interface SentMessage {
  kind: 'post' | 'update';
  channel: string;
  ts?: string;
  thread_ts?: string;
  text: string;
  blocks?: KnownBlock[];
}

class FakeSlackChat implements SlackChat {
  readonly sent: SentMessage[] = [];
  private nextTs = 1;

  async postMessage(message: { channel: string; thread_ts?: string; text: string; blocks?: KnownBlock[] }) {
    const ts = `9${this.nextTs++}.000`;
    this.sent.push({ kind: 'post', ts, ...message });
    return { ts };
  }

  async update(message: { channel: string; ts: string; text: string; blocks?: KnownBlock[] }) {
    this.sent.push({ kind: 'update', ...message });
    return {};
  }

  lastUpdateOf(ts: string): SentMessage | undefined {
    return this.sent.filter((message) => message.kind === 'update' && message.ts === ts).at(-1);
  }
}

function dm(text: string, overrides: Partial<IncomingSlackMessage> = {}): IncomingSlackMessage {
  return { channel: CHANNEL, channelType: 'im', ts: '100.001', user: 'U1', text, ...overrides };
}

function buttons(blocks: KnownBlock[] | undefined): Array<ActionsBlockElement | SectionBlockAccessory> {
  return (blocks ?? []).flatMap((block): Array<ActionsBlockElement | SectionBlockAccessory> => {
    if (block.type === 'actions') return block.elements;
    if (block.type === 'section' && block.accessory) return [block.accessory];
    return [];
  });
}

function buttonValue(blocks: KnownBlock[] | undefined, match: (actionId: string, label: string) => boolean) {
  const button = buttons(blocks).find(
    (element) => element.type === 'button' && match(element.action_id ?? '', element.text.text),
  );
  return button?.type === 'button' ? button.value : undefined;
}

describe('Slack handlers', () => {
  let store: InMemoryConversationStore;
  let llm: ScriptedLlm;
  let chat: FakeSlackChat;
  let handlers: ReturnType<typeof createSlackHandlers>;

  beforeEach(() => {
    store = new InMemoryConversationStore();
    llm = new ScriptedLlm();
    chat = new FakeSlackChat();
    const assistant = new TripAssistant({ store, llm, now: () => new Date('2027-01-10T12:00:00Z') });
    handlers = createSlackHandlers({ store, assistant, log: SILENT_LOG });
  });

  it('replies in the DM itself by replacing a placeholder, with a hint and a New trip button', async () => {
    llm.then(textReply('Try **Lisbon** in May.'));

    await handlers.handleMessage(dm('Europe in May?'), chat);

    const [placeholder, update] = chat.sent;
    expect(placeholder).toMatchObject({ kind: 'post', text: THINKING_TEXT });
    expect(placeholder?.thread_ts).toBeUndefined();
    expect(update).toMatchObject({ kind: 'update', ts: placeholder?.ts, text: 'Try *Lisbon* in May.' });
    expect(JSON.stringify(update?.blocks)).toContain(SESSION_HINT);
    expect(buttonValue(update?.blocks, (actionId) => actionId === NEW_TRIP_ACTION_ID)).toBeDefined();
  });

  it('keeps one conversation per DM until the user starts a new trip', async () => {
    llm.then(textReply('First'), textReply('Follow-up'), textReply('Fresh start'));

    await handlers.handleMessage(dm('Hi', { ts: '100.001' }), chat);
    await handlers.handleMessage(dm('More please', { ts: '100.002' }), chat);
    await handlers.handleMessage(dm('new trip', { ts: '200.000' }), chat);
    await handlers.handleMessage(dm('Somewhere cold', { ts: '200.001' }), chat);

    expect(store.listConversations('slack:U1').map(({ id }) => id).sort()).toEqual([
      'slack:D123:100.001',
      'slack:D123:200.000',
    ]);
    expect(llm.requests[1]?.messages.map(({ role }) => role)).toEqual(['user', 'assistant', 'user']);
    expect(llm.requests[2]?.messages).toHaveLength(1);
    expect(chat.sent.some(({ text }) => text.includes('New trip started'))).toBe(true);
  });

  it('starts a new trip from the button, once per click', async () => {
    llm.then(textReply('First'), textReply('Second'));
    await handlers.handleMessage(dm('Hi', { ts: '100.001' }), chat);

    await handlers.handleNewTrip({ userId: 'U1', channel: CHANNEL, actionTs: '150.000' }, chat);
    await handlers.handleNewTrip({ userId: 'U1', channel: CHANNEL, actionTs: '150.000' }, chat);
    await handlers.handleMessage(dm('Hello again', { ts: '150.001' }), chat);

    expect(chat.sent.filter(({ text }) => text.includes('New trip started'))).toHaveLength(1);
    expect(llm.requests[1]?.messages).toHaveLength(1);
  });

  it('processes a duplicate Slack event only once', async () => {
    llm.then(textReply('Only once'));

    await handlers.handleMessage(dm('Hello'), chat);
    await handlers.handleMessage(dm('Hello'), chat);

    expect(llm.requests).toHaveLength(1);
    expect(chat.sent).toHaveLength(2);
  });

  it('ignores bot messages, edits, channels and empty text', async () => {
    await handlers.handleMessage(dm('from a bot', { botId: 'B1' }), chat);
    await handlers.handleMessage(dm('edited', { subtype: 'message_changed' }), chat);
    await handlers.handleMessage(dm('in a channel', { channelType: 'channel' }), chat);
    await handlers.handleMessage(dm('   '), chat);

    expect(chat.sent).toEqual([]);
    expect(llm.requests).toEqual([]);
  });

  it('shows an LLM failure as a warning that says how to proceed', async () => {
    llm.then(new LlmError('unavailable', '503'));

    await handlers.handleMessage(dm('Hi'), chat);

    expect(chat.sent.at(-1)?.text).toBe(
      ":warning: I couldn't reach the AI service, so your message wasn't saved. Please try again.",
    );
  });

  it('confirms a proposal from the button, updates the card and posts the outcome once', async () => {
    llm.then(toolReply({ name: 'propose_trip', args: LISBON_BOOKING }), textReply('Here is your stay.'));
    await handlers.handleMessage(dm('Book Lisbon'), chat);
    const card = chat.sent.find((message) => message.kind === 'update');
    const value = buttonValue(card?.blocks, (actionId) => actionId === CONFIRM_ACTION_ID);
    expect(value).toBeDefined();

    await handlers.handleButtonClick({ userId: 'U1', channel: CHANNEL, decision: 'confirm', value }, chat);
    await handlers.handleButtonClick({ userId: 'U1', channel: CHANNEL, decision: 'confirm', value }, chat);

    const updatedCard = chat.lastUpdateOf(card?.ts ?? '');
    expect(buttonValue(updatedCard?.blocks, (actionId) => actionId === CONFIRM_ACTION_ID)).toBeUndefined();
    expect(JSON.stringify(updatedCard?.blocks)).toContain('Booked');
    const outcomes = chat.sent.filter((message) => message.text.includes('Trip booked: Lisbon'));
    expect(outcomes).toHaveLength(1);
    expect(store.getUser('slack:U1').bookings).toHaveLength(1);
  });

  it('marks the old card as replaced when a new proposal is made', async () => {
    llm.then(
      toolReply({ name: 'propose_trip', args: LISBON_BOOKING }),
      textReply('5 nights proposed.'),
      toolReply({ name: 'propose_trip', args: { ...LISBON_BOOKING, nights: 3 } }),
      textReply('3 nights proposed.'),
    );
    await handlers.handleMessage(dm('Book Lisbon'), chat);
    const firstCard = chat.sent.find((message) => message.kind === 'update');

    await handlers.handleMessage(dm('Make it 3 nights', { ts: '100.005' }), chat);

    expect(JSON.stringify(chat.lastUpdateOf(firstCard?.ts ?? '')?.blocks)).toContain('Replaced by a newer proposal');
  });

  it("does not let another Slack user confirm someone else's proposal", async () => {
    llm.then(toolReply({ name: 'propose_trip', args: LISBON_BOOKING }), textReply('Here is your stay.'));
    await handlers.handleMessage(dm('Book Lisbon'), chat);
    const value = buttonValue(
      chat.sent.find((message) => message.kind === 'update')?.blocks,
      (actionId) => actionId === CONFIRM_ACTION_ID,
    );

    await handlers.handleButtonClick({ userId: 'U2', channel: CHANNEL, decision: 'confirm', value }, chat);

    expect(chat.sent.at(-1)?.text).toContain('no longer available');
    expect(store.getUser('slack:U1').bookings).toEqual([]);
  });

  it('keeps going when Slack delivery fails', async () => {
    llm.then(textReply('Hello'));
    const failingChat: SlackChat = {
      postMessage: () => Promise.reject(new Error('channel_not_found')),
      update: () => Promise.reject(new Error('channel_not_found')),
    };

    await expect(handlers.handleMessage(dm('Hi'), failingChat)).resolves.toBeUndefined();
    expect(store.listMessages('slack:U1', 'slack:D123:100.001')).toHaveLength(2);
  });

  it('shows quick replies and destination cards as buttons that continue the chat', async () => {
    llm.then(
      toolReply({ name: 'search_destinations', args: { region: 'Oceania' } }),
      textReply('Two great picks.\nQuick replies: Show cheaper | Tell me more'),
      textReply('Planning Sydney.'),
    );

    await handlers.handleMessage(dm('Oceania?'), chat);
    const reply = chat.sent.find((message) => message.kind === 'update');
    const planValue = buttonValue(reply?.blocks, (_actionId, label) => label === 'Plan this trip');
    expect(reply?.text).toBe('Two great picks.');
    expect(buttonValue(reply?.blocks, (_actionId, label) => label === 'Show cheaper')).toBeDefined();
    expect(planValue).toBeDefined();

    await handlers.handleQuickReply({ userId: 'U1', channel: CHANNEL, actionTs: '1.1', value: planValue }, chat);
    await handlers.handleQuickReply({ userId: 'U1', channel: CHANNEL, actionTs: '1.1', value: planValue }, chat);

    expect(llm.requests).toHaveLength(3);
    expect(llm.requests[2]?.messages.at(-1)).toMatchObject({ role: 'user', text: expect.stringMatching(/^Plan a trip to /) });
  });
});

describe('Slack formatting', () => {
  it('converts Markdown to Slack mrkdwn', () => {
    expect(toSlackMrkdwn('**Tulum**\n* Beaches\n- Cenotes\n## Tips\n[Map](https://example.com)')).toBe(
      '*Tulum*\n• Beaches\n• Cenotes\n*Tips*\n<https://example.com|Map>',
    );
  });

  it('escapes Slack control characters in model text', () => {
    expect(toSlackMrkdwn('Ping <!channel> & compare a < b')).toBe('Ping &lt;!channel&gt; &amp; compare a &lt; b');
  });

  it('renders the trip card with a route header and a plain-text fallback', () => {
    const proposal = sampleProposal({
      flight: {
        airline: 'Skylark Air',
        flightNumber: 'SKL 101',
        originAirport: 'TLV',
        destinationAirport: 'LIS',
        departTime: '08:00',
        durationHours: 5,
        stops: 0,
        priceUsdPerTraveler: 300,
        compareUrl: 'https://www.google.com/travel/flights?q=x',
      },
    });
    const { text, blocks } = buildReplyContent(
      { id: 'm1', role: 'assistant', text: 'Here you go', createdAt: '', proposal },
      'c',
      { showSessionHint: false },
    );

    expect(text).toContain('Reply "confirm" or "cancel"');
    expect(blocks).toContainEqual(expect.objectContaining({ type: 'header', text: expect.objectContaining({ text: 'TLV  ✈  LIS' }) }));
  });

  it('rejects malformed button values', () => {
    expect(parseActionValue('not json')).toBeUndefined();
    expect(parseActionValue('{"proposalId":"p1"}')).toBeUndefined();
  });
});

describe('Slack config', () => {
  it('rejects swapped or placeholder tokens', () => {
    expect(() => loadConfig({ GEMINI_API_KEY: 'k', SLACK_BOT_TOKEN: 'xapp-123', SLACK_APP_TOKEN: 'xoxb-123' })).toThrow(
      /SLACK_BOT_TOKEN: must start with xoxb-[\s\S]*SLACK_APP_TOKEN: must start with xapp-/,
    );
    expect(() => loadConfig({ GEMINI_API_KEY: 'k', SLACK_BOT_TOKEN: 'xoxb-' })).toThrow(/must start with xoxb-/);
    expect(loadConfig({ GEMINI_API_KEY: 'k', SLACK_BOT_TOKEN: '' }).SLACK_BOT_TOKEN).toBeUndefined();
    expect(() => loadConfig({ GEMINI_API_KEY: 'k', SLACK_APP_TOKEN: 'xoxe-1-refresh' })).toThrow(/must start with xapp-/);
  });

  it('accepts rotating xoxe.-prefixed tokens', () => {
    const config = loadConfig({ GEMINI_API_KEY: 'k', SLACK_BOT_TOKEN: 'xoxe.xoxb-1-abc', SLACK_APP_TOKEN: 'xoxe.xapp-1-abc' });

    expect(config).toMatchObject({ SLACK_BOT_TOKEN: 'xoxe.xoxb-1-abc', SLACK_APP_TOKEN: 'xoxe.xapp-1-abc' });
  });
});
