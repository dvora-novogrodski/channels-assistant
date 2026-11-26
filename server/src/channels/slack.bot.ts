import {
  App,
  LogLevel,
  type AllMiddlewareArgs,
  type BlockAction,
  type ButtonAction,
  type SlackActionMiddlewareArgs,
  type webApi,
} from '@slack/bolt';
import type { ProposalDecision } from '@app/shared';
import type { TravelService } from '../core/travelService.js';
import { CANCEL_ACTION_ID, CONFIRM_ACTION_ID, NEW_TRIP_ACTION_ID, QUICK_REPLY_ACTION_PREFIX } from './slack.blocks.js';
import { createSlackHandlers, type SlackActionClick, type SlackChat } from './slack.handlers.js';

interface SlackBotSettings {
  botToken: string;
  appToken: string;
  service: TravelService;
}

type ButtonActionArgs = SlackActionMiddlewareArgs<BlockAction<ButtonAction>> & AllMiddlewareArgs;
type ButtonClickHandler = (click: SlackActionClick, chat: SlackChat) => Promise<void>;

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

function onButtonClick(handle: ButtonClickHandler) {
  return async ({ ack, body, action, client }: ButtonActionArgs) => {
    await ack();
    const channel = body.channel?.id;
    if (!channel) return;
    const click = { userId: body.user.id, channel, actionTs: action.action_ts, value: action.value };
    await handle(click, toSlackChat(client));
  };
}

export async function startSlackBot({ botToken, appToken, service }: SlackBotSettings): Promise<App> {
  const app = new App({ token: botToken, appToken, socketMode: true, logLevel: LogLevel.WARN });
  const handlers = createSlackHandlers({ service });

  app.message(async ({ message, client }) => {
    if (message.subtype !== undefined) return;
    const incoming = {
      channel: message.channel,
      channelType: message.channel_type,
      ts: message.ts,
      threadTs: message.thread_ts,
      user: message.user,
      text: message.text,
      botId: message.bot_id,
    };
    await handlers.handleMessage(incoming, toSlackChat(client));
  });

  for (const [actionId, decision] of BUTTON_DECISIONS) {
    app.action<BlockAction<ButtonAction>>(
      actionId,
      onButtonClick((click, chat) => handlers.handleButtonClick({ ...click, decision }, chat)),
    );
  }
  app.action<BlockAction<ButtonAction>>(new RegExp(`^${QUICK_REPLY_ACTION_PREFIX}`), onButtonClick(handlers.handleQuickReply));
  app.action<BlockAction<ButtonAction>>(NEW_TRIP_ACTION_ID, onButtonClick(handlers.handleNewTrip));

  app.error(async (error) => {
    console.error('Slack app error', error);
  });

  await app.start();
  return app;
}
