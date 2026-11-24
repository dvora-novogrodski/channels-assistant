# Slack setup

The bot uses **Socket Mode**: it opens an outgoing WebSocket to Slack, so no public URL, webhook or request signing is needed. Everything below is free.

## 1. Create a workspace (skip if you have one)

Go to <https://slack.com/get-started#/createnew> and sign up with your email. No phone number is required.

## 2. Create the app from the manifest

1. Open <https://api.slack.com/apps> → **Create New App** → **From a manifest**.
2. Pick your workspace.
3. Choose **YAML**, replace the content with [`slack-app-manifest.yml`](../slack-app-manifest.yml), and create the app.

The manifest enables Socket Mode, interactivity (for the Confirm / Cancel buttons), the Messages tab, the `message.im` event, and the bot scopes `chat:write`, `im:history`, `im:read`, `im:write`.

It also keeps **token rotation off**. With rotation on, Slack issues `xoxe.xapp-…` tokens that expire every 12 hours and single-use refresh tokens, which a server without persistent storage cannot keep renewing. Rotation cannot be turned off once enabled, so if the App-Level Tokens section shows rotation on, create a fresh app from the manifest instead.

## 3. Get the two tokens

| Variable | Where | Starts with |
|---|---|---|
| `SLACK_APP_TOKEN` | **Basic Information** → **App-Level Tokens** → **Generate Token and Scopes**, add the `connections:write` scope | `xapp-` |
| `SLACK_BOT_TOKEN` | **Install App** → **Install to Workspace** → copy the **Bot User OAuth Token** | `xoxb-` |

Put both in `.env`. The server checks the prefixes at startup, so swapped tokens fail with a clear message. If the app token starts with `xoxe.xapp-`, rotation is on and the bot will stop reconnecting after about 12 hours (see step 2).

## 4. Run and chat

```powershell
npm run dev:server
```

The log should show `Slack bot connected (Socket Mode)`. In Slack, open **Apps → Travel Assistant** and send a direct message.

## Conversation model

- Each **new direct message** starts a new conversation. The bot replies in a thread under it.
- **Replies in that thread** are follow-ups in the same conversation.
- The DM itself is the chat history: every thread is one past chat.
- Conversation id: `slack:<channel>:<thread ts>`; user id: `slack:<Slack user id>`.

Why threads: they give Slack a native "new chat" and "history" without extra commands, and follow-ups stay clearly grouped. The trade-off is that a follow-up sent outside the thread starts a new chat, which is why the first reply in each thread says so.

## Inviting reviewers

In Slack: workspace name → **Invite people** → **Copy invite link**. Share the link; anyone who joins can DM the bot.
