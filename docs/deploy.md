# Deploying to Render (free)

One Render web service runs everything: the Express API, the built React app, and the Slack bot (Socket Mode opens an outbound WebSocket, so Slack needs no public URL). [`render.yaml`](../render.yaml) describes the service.

## Before you start

- **Slack tokens must not rotate.** A rotating app token (`xoxe.xapp-…`) expires every 12 hours and needs a single-use refresh token that a free Render instance cannot persist. Use an app created from [`slack-app-manifest.yml`](../slack-app-manifest.yml) with an app token that starts with plain `xapp-`. See [slack-setup.md](slack-setup.md).
- **Run the Slack bot in one place only.** If your laptop and Render both connect with the same tokens, Slack splits events between them and each has its own in-memory history. Once deployed, clear `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` in your local `.env` (the web app still runs locally without them).

## 1. Create the service

1. Sign up at <https://render.com> and connect your GitHub account (Account Settings → Git Deployment Credentials). Give the Render GitHub app access to `channels-assistant`.
2. **New → Blueprint**, pick the `channels-assistant` repository. Render reads `render.yaml`.
3. Render asks for the secret values (`sync: false`): paste `GEMINI_API_KEY`, `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`. They are only prompted on first creation; change them later under the service's **Environment** tab.
4. Deploy. The build runs `npm ci && npm run build` (installs all workspaces and builds the web app), then starts the server with `npm run start:hosted -w server`. That script skips the local-only `--use-system-ca` flag (needed on Windows behind TLS-inspecting filters) and reads settings from Render's environment instead of `.env`.
5. Check the logs for `Server listening…` and `Slack bot connected (Socket Mode)`, then open `https://<service>.onrender.com`.

Settings worth knowing:

| Setting | Value | Why |
|---|---|---|
| `NODE_VERSION` | `22` | New Render services default to a newer Node; the project targets Node 22. |
| `PORT` | `10000` | Render's default web port. |
| `DEMO_FAILURES` | `true` | Lets reviewers type `simulate failure` to see the error path. |
| Health check | `/api/health` | Render restarts the service if it stops answering. |

## 2. Keep it awake

Free services spin down after 15 minutes without **inbound** traffic, and an outbound Slack WebSocket does not count. While asleep the Slack bot is disconnected and in-memory chats are lost on wake-up.

Create a free monitor at <https://uptimerobot.com>: HTTP(s) type, URL `https://<service>.onrender.com/api/health`, interval 5 minutes. One always-on service uses about 744 of the 750 free instance hours per month.

## Known limits of the free plan

- Render may restart a free service at any time; conversations and bookings live in memory, so a restart clears them.
- The first request after a spin-down takes about a minute.
- Gemini's free tier can return 503/504 during busy periods; the app falls back to a second model and retries once, then shows a retryable error.
