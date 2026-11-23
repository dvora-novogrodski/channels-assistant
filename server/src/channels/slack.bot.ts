import { App, LogLevel, type BlockAction, type ButtonAction, type webApi } from '@slack/bolt';
import type { TripAssistant } from '../core/assistant.js';
import type { ProposalDecision } from '../core/proposals.js';
import type { ConversationStore } from '../core/store.js';
import { CANCEL_ACTION_ID, CONFIRM_ACTION_ID } from './slack.blocks.js';
import { createSlackHandlers, type SlackChat } from './slack.handlers.js';

interface SlackBotSettings {
  botToken: string;
  appToken: string;
  store: ConversationStore;
  assistant: TripAssistant;
}

const BUTTON_DECISIONS: Array<[actionId: string, decision: ProposalDecision]> = [
  [CONFIRM_ACTION_ID, 'confirm'],
  [CANCEL_ACTION_ID, 'cancel'],
];

function toSlackChat(client: webApi.WebClient): SlackChat {
  return {
    postMessage: (message) => client.chat.postMessage(message),
    update: (message) => client.chat.update(message),
  };
}

export async function startSlackBot({ botToken, appToken, store, assistant }: SlackBotSettings): Promise<App> {
  const app = new App({ token: botToken, appToken, socketMode: true, logLevel: LogLevel.WARN });
  const handlers = createSlackHandlers({ store, assistant });

  app.message(async ({ message, client }) => {
    if (message.subtype !== undefined) return;
    await handlers.handleMessage(
      {
        channel: message.channel,
        channelType: message.channel_type,
        ts: message.ts,
        threadTs: message.thread_ts,
        user: message.user,
        text: message.text,
        botId: message.bot_id,
      },
      toSlackChat(client),
    );
  });

  for (const [actionId, decision] of BUTTON_DECISIONS) {
    app.action<BlockAction<ButtonAction>>(actionId, async ({ ack, body, action, client }) => {
      await ack();
      const channel = body.channel?.id;
      if (!channel) return;
      await handlers.handleButtonClick({ userId: body.user.id, channel, decision, value: action.value }, toSlackChat(client));
    });
  }

  app.error(async (error) => {
    console.error('Slack app error', error);
  });

  await app.start();
  return app;
}
