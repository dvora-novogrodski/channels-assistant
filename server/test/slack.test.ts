import type { KnownBlock } from '@slack/types';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CONFIRM_ACTION_ID,
  THREAD_HINT,
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
import { ScriptedLlm, textReply, toolReply } from './scriptedLlm.js';

const CHANNEL = 'D123';
const LISBON_BOOKING = { destinationId: 'lisbon-pt', startDate: '2027-05-12', nights: 5, travelers: 2 };

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

function findButtonValue(blocks: KnownBlock[] | undefined): string | undefined {
  for (const block of blocks ?? []) {
    if (block.type !== 'actions') continue;
    for (const element of block.elements) {
      if (element.type === 'button' && element.action_id === CONFIRM_ACTION_ID) return element.value;
    }
  }
  return undefined;
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
    handlers = createSlackHandlers({ store, assistant, log: { warn: () => {}, error: () => {} } });
  });

  it('replies in a thread by replacing a thinking placeholder, with a hint for new chats', async () => {
    llm.then(textReply('Try **Lisbon** in May.'));

    await handlers.handleMessage(dm('Europe in May?'), chat);

    const [placeholder, update] = chat.sent;
    expect(placeholder).toMatchObject({ kind: 'post', thread_ts: '100.001', text: THINKING_TEXT });
    expect(update).toMatchObject({ kind: 'update', ts: placeholder?.ts, text: 'Try *Lisbon* in May.' });
    expect(JSON.stringify(update?.blocks)).toContain(THREAD_HINT);
  });

  it('treats each thread as its own conversation and keeps follow-ups in it', async () => {
    llm.then(textReply('First chat'), textReply('Follow-up'), textReply('Second chat'));

    await handlers.handleMessage(dm('Hi', { ts: '100.001' }), chat);
    await handlers.handleMessage(dm('More please', { ts: '100.002', threadTs: '100.001' }), chat);
    await handlers.handleMessage(dm('New topic', { ts: '200.001' }), chat);

    expect(store.listConversations('slack:U1').map(({ id }) => id).sort()).toEqual([
      'slack:D123:100.001',
      'slack:D123:200.001',
    ]);
    expect(llm.requests[1]?.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(llm.requests[2]?.messages).toHaveLength(1);
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

  it('shows an LLM failure as a warning with a retry hint', async () => {
    llm.then(new LlmError('unavailable', '503'));

    await handlers.handleMessage(dm('Hi'), chat);

    expect(chat.sent.at(-1)?.text).toMatch(/^:warning: I couldn't reach the AI service.*Send your message again to retry\.$/);
  });

  it('confirms a proposal from the button, updates the card and posts the outcome once', async () => {
    llm.then(toolReply({ name: 'propose_booking', args: LISBON_BOOKING }), textReply('Here is your stay.'));
    await handlers.handleMessage(dm('Book Lisbon'), chat);
    const card = chat.sent.find((message) => message.kind === 'update');
    const value = findButtonValue(card?.blocks);
    expect(value).toBeDefined();

    await handlers.handleButtonClick({ userId: 'U1', channel: CHANNEL, decision: 'confirm', value }, chat);
    await handlers.handleButtonClick({ userId: 'U1', channel: CHANNEL, decision: 'confirm', value }, chat);

    const updatedCard = chat.lastUpdateOf(card?.ts ?? '');
    expect(findButtonValue(updatedCard?.blocks)).toBeUndefined();
    expect(JSON.stringify(updatedCard?.blocks)).toContain('Booked');
    const outcomes = chat.sent.filter((message) => message.text.includes('Stay booked: Lisbon'));
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ kind: 'post', thread_ts: '100.001' });
    expect(store.getUser('slack:U1').bookings).toHaveLength(1);
  });

  it('marks the old card as replaced when a new proposal is made in the thread', async () => {
    llm.then(
      toolReply({ name: 'propose_booking', args: LISBON_BOOKING }),
      textReply('5 nights proposed.'),
      toolReply({ name: 'propose_booking', args: { ...LISBON_BOOKING, nights: 3 } }),
      textReply('3 nights proposed.'),
    );
    await handlers.handleMessage(dm('Book Lisbon'), chat);
    const firstCard = chat.sent.find((message) => message.kind === 'update');

    await handlers.handleMessage(dm('Make it 3 nights', { ts: '100.005', threadTs: '100.001' }), chat);

    expect(JSON.stringify(chat.lastUpdateOf(firstCard?.ts ?? '')?.blocks)).toContain('Replaced by a newer proposal');
  });

  it("does not let another Slack user confirm someone else's proposal", async () => {
    llm.then(toolReply({ name: 'propose_booking', args: LISBON_BOOKING }), textReply('Here is your stay.'));
    await handlers.handleMessage(dm('Book Lisbon'), chat);
    const value = findButtonValue(chat.sent.find((message) => message.kind === 'update')?.blocks);

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
});

describe('Slack formatting', () => {
  it('converts Markdown to Slack mrkdwn', () => {
    expect(toSlackMrkdwn('**Tulum**\n* Beaches\n- Cenotes\n## Tips\n[Map](https://example.com)')).toBe(
      '*Tulum*\n• Beaches\n• Cenotes\n*Tips*\n<https://example.com|Map>',
    );
  });

  it('includes a plain-text fallback for proposals', () => {
    const { text } = buildReplyContent(
      {
        id: 'm1',
        role: 'assistant',
        text: 'Here you go',
        createdAt: '',
        proposal: {
          id: 'p1',
          destinationId: 'lisbon-pt',
          destinationName: 'Lisbon',
          country: 'Portugal',
          startDate: '2027-05-12',
          endDate: '2027-05-17',
          nights: 5,
          travelers: 2,
          estimatedTotalUsd: 1400,
          status: 'proposed',
        },
      },
      { conversationId: 'c', threadTs: 't' },
      { showThreadHint: false },
    );

    expect(text).toContain('Reply "confirm" or "cancel"');
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
