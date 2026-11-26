import type { ActionsBlockElement, KnownBlock, SectionBlockAccessory } from '@slack/types';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CONFIRM_ACTION_ID,
  CONTINUE_TRIP_ACTION_ID,
  MY_TRIPS_ACTION_ID,
  NEW_TRIP_ACTION_ID,
  NO_EARLIER_TRIPS_TEXT,
  SESSION_HINT,
  buildReplyContent,
  parseActionValue,
  toSlackMrkdwn,
} from '../src/channels/slack.blocks.js';
import {
  DELIVERY_FAILED_TEXT,
  THINKING_TEXT,
  createSlackHandlers,
  type IncomingSlackMessage,
  type SlackChat,
} from '../src/channels/slack.handlers.js';
import { loadConfig } from '../src/config.js';
import { TripAssistant } from '../src/core/assistant.js';
import { LlmError } from '../src/core/llm/types.js';
import { InMemoryConversationStore } from '../src/core/store.js';
import { TravelService } from '../src/core/travelService.js';
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
    handlers = createSlackHandlers({ service: new TravelService({ store, assistant }), log: SILENT_LOG, pause: () => Promise.resolve() });
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
    expect(JSON.stringify(updatedCard?.blocks)).toContain('Hotel voucher');
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
        roundTripPriceUsdPerTraveler: 300,
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

describe('Slack reliability fixes', () => {
  function setup(...replies: Parameters<ScriptedLlm['then']>) {
    const store = new InMemoryConversationStore();
    const llm = new ScriptedLlm(...replies);
    const assistant = new TripAssistant({ store, llm, now: () => new Date('2027-01-10T12:00:00Z') });
    const handlers = createSlackHandlers({ service: new TravelService({ store, assistant }), log: SILENT_LOG, pause: () => Promise.resolve() });
    return { store, handlers };
  }

  it('splits long replies into sections under the Slack limit', () => {
    const paragraph = 'x'.repeat(1200);
    const { blocks } = buildReplyContent(
      { id: 'm', role: 'assistant', text: [paragraph, paragraph, paragraph, paragraph].join('\n\n'), createdAt: '' },
      'c',
      { showSessionHint: false },
    );
    const sections = blocks.filter((block) => block.type === 'section');

    expect(sections.length).toBeGreaterThan(1);
    for (const section of sections) {
      expect(section.type === 'section' ? (section.text?.text.length ?? 0) : 0).toBeLessThanOrEqual(2900);
    }
  });

  it('replaces the placeholder with a notice when the reply cannot be delivered', async () => {
    const { handlers } = setup(textReply('Hello'));
    const chat = new FakeSlackChat();
    let updates = 0;
    const flakyChat: SlackChat = {
      postMessage: (message) => chat.postMessage(message),
      update: (message) => (updates++ === 0 ? Promise.reject(new Error('invalid_blocks')) : chat.update(message)),
    };

    await handlers.handleMessage(dm('Hi'), flakyChat);

    expect(chat.sent.at(-1)).toMatchObject({ kind: 'update', text: DELIVERY_FAILED_TEXT });
  });

  it('shows booking progress before the booked card and keeps the New trip button', async () => {
    const { handlers } = setup(toolReply({ name: 'propose_trip', args: LISBON_BOOKING }), textReply('Ready.'));
    const chat = new FakeSlackChat();
    await handlers.handleMessage(dm('Book Lisbon'), chat);
    const card = chat.sent.find((message) => message.kind === 'update');
    const value = buttonValue(card?.blocks, (actionId) => actionId === CONFIRM_ACTION_ID);

    await handlers.handleButtonClick({ userId: 'U1', channel: CHANNEL, decision: 'confirm', value }, chat);

    const cardUpdates = chat.sent.filter((message) => message.kind === 'update' && message.ts === card?.ts);
    expect(cardUpdates.filter((message) => message.text === 'Booking your trip…')).toHaveLength(4);
    expect(buttonValue(cardUpdates.at(-1)?.blocks, (actionId) => actionId === NEW_TRIP_ACTION_ID)).toBeDefined();
    expect(cardUpdates.at(-1)?.text).not.toContain('Reply "confirm"');
  });
});

describe('Slack my trips', () => {
  let store: InMemoryConversationStore;
  let llm: ScriptedLlm;
  let chat: FakeSlackChat;
  let handlers: ReturnType<typeof createSlackHandlers>;

  beforeEach(() => {
    store = new InMemoryConversationStore();
    llm = new ScriptedLlm();
    chat = new FakeSlackChat();
    const assistant = new TripAssistant({ store, llm, now: () => new Date('2027-01-10T12:00:00Z') });
    handlers = createSlackHandlers({ service: new TravelService({ store, assistant }), log: SILENT_LOG, pause: () => Promise.resolve() });
  });

  async function startTwoTrips() {
    llm.then(textReply('Lisbon is lovely.'), textReply('Tokyo in spring!'));
    await handlers.handleMessage(dm('Lisbon in May', { ts: '100.001' }), chat);
    await handlers.handleMessage(dm('new trip', { ts: '200.000' }), chat);
    await handlers.handleMessage(dm('Tokyo in April', { ts: '200.001' }), chat);
  }

  it('offers a My trips button next to New trip', async () => {
    llm.then(textReply('Hello'));
    await handlers.handleMessage(dm('Hi'), chat);

    expect(buttonValue(chat.sent.at(-1)?.blocks, (actionId) => actionId === MY_TRIPS_ACTION_ID)).toBeDefined();
  });

  it('lists earlier trips with Continue and marks the current one', async () => {
    await startTwoTrips();

    await handlers.handleMessage(dm('my trips', { ts: '300.000' }), chat);

    const list = chat.sent.at(-1);
    expect(list?.text).toContain('Lisbon in May');
    expect(list?.text).toContain('Tokyo in April');
    const continueValues = buttons(list?.blocks)
      .filter((element) => element.type === 'button' && element.action_id === CONTINUE_TRIP_ACTION_ID)
      .map((element) => (element.type === 'button' ? element.value : undefined));
    expect(continueValues).toEqual([JSON.stringify({ conversationId: 'slack:D123:100.001' })]);
    expect(JSON.stringify(list?.blocks)).toContain('Current trip');
  });

  it('continues an earlier trip with its history', async () => {
    await startTwoTrips();
    llm.then(textReply('Pack light layers for Lisbon.'));

    const value = JSON.stringify({ conversationId: 'slack:D123:100.001' });
    await handlers.handleContinueTrip({ userId: 'U1', channel: CHANNEL, actionTs: '300.100', value }, chat);
    await handlers.handleContinueTrip({ userId: 'U1', channel: CHANNEL, actionTs: '300.100', value }, chat);
    await handlers.handleMessage(dm('What should I pack?', { ts: '300.200' }), chat);

    expect(chat.sent.filter(({ text }) => text.includes('Back to: Lisbon in May'))).toHaveLength(1);
    expect(llm.requests.at(-1)?.messages.map((message) => (message.role === 'user' ? message.text : message.role))).toEqual([
      'Lisbon in May',
      'assistant',
      'What should I pack?',
    ]);
    expect(store.listMessages('slack:U1', 'slack:D123:100.001')).toHaveLength(4);
  });

  it("does not continue another user's trip", async () => {
    await startTwoTrips();

    const value = JSON.stringify({ conversationId: 'slack:D123:100.001' });
    await handlers.handleContinueTrip({ userId: 'U2', channel: CHANNEL, actionTs: '400.000', value }, chat);

    expect(chat.sent.at(-1)?.text).toContain('no longer available');
  });

  it('explains when there are no trips yet', async () => {
    await handlers.handleMyTrips({ userId: 'U1', channel: CHANNEL, actionTs: '500.000' }, chat);

    expect(chat.sent.at(-1)?.text).toBe(NO_EARLIER_TRIPS_TEXT);
  });
});
