# Demo video

Everything needed to re-make the demo video after the app changes. The video is recorded from the live app, sped up while the AI is thinking, and put together with [HyperFrames](https://hyperframes.heygen.com).

```
record-web.mjs / record-slack.mjs  →  recordings/<clip>/ (frames + timeline.json)
build.mjs                          →  composition/assets/recordings/<clip>.mp4 + composition/timeline.json
compose.mjs + captions.mjs         →  composition/index.html
hyperframes render                 →  out/travel-assistant-demo.mp4
```

## Steps

```powershell
npm install
npx playwright install chromium   # Slack recording uses your installed Google Chrome
```

1. **Sign in to Slack once** (only needed when the saved session expires): `npm run login:slack`, sign in in the window that opens, then close it. The session is saved in `.slack-profile/` (git-ignored, never commit it).
2. **Record**: `npm run record` (or `npm run record:web` / `npm run record:slack` to redo one clip). Each script prints the marks it recorded.
3. **Build the clips and the composition**: `npm run build`
4. **Check and preview** (optional): `npm run check`, `npm run preview`
5. **Render**: `npm run render` → `out/travel-assistant-demo.mp4`

The paced clips in `composition/assets/recordings/` are committed; the raw frames in `recordings/` are not. To change only the captions or titles, edit `scripts/captions.mjs`, then run `npm run compose` and `npm run render` (no re-recording).

## What each file does

| File | Purpose |
|---|---|
| `scripts/record-web.mjs` | Drives the live web app: search, follow-up, booking with a saved card, a simulated AI failure and recovery, and a second visitor (`isolation` clip). |
| `scripts/record-slack.mjs` | Drives the Travel Assistant DM in Slack and crops to the conversation pane (no sidebar or header). |
| `scripts/probe-slack.mjs` | Prints the Slack page layout, for fixing the crop if Slack changes its markup. |
| `scripts/lib/recorder.mjs` | Records timestamped frames through the Chrome DevTools screencast and saves named marks. |
| `scripts/build.mjs` | Turns frames into MP4 clips. Waiting for the AI (from `send:X` to `reply:X`) is compressed to 2 seconds. |
| `scripts/captions.mjs` | Caption text per mark, plus the intro, Slack and outro titles. |
| `scripts/compose.mjs` | Generates `composition/index.html`, timing every caption and scene from the recorded marks. |
| `scripts/render.mjs` | Runs the HyperFrames render with the bundled ffmpeg and ffprobe on PATH. |

## Settings

| Variable | Default |
|---|---|
| `DEMO_URL` | `https://travel-assistant-caod.onrender.com` |
| `SLACK_DM_URL` | The Travel Assistant DM in the demo workspace |
| `SLACK_WORKSPACE_URL` | `https://app.slack.com/client` (used by `login:slack`) |

The web recording sends `simulate failure` to show the error state, so the server must run with `DEMO_FAILURES` enabled. The free Render instance sleeps when idle: open the site once before recording.
