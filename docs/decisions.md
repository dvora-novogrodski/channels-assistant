# Code walkthrough and decision log

## Read the code in this order

| # | File | What to understand |
|---|---|---|
| 1 | `shared/src/api.ts` | The contract between server and UI: messages, proposals, tickets, request bodies. |
| 2 | `server/src/core/store.ts` | Users own bookings and preferences; conversations own LLM history, transcript and proposals. Reads return copies; every change goes through one `commit`. |
| 3 | `server/src/core/assistant.ts` | The heart: one turn = tool loop on a copy of history, commit only on success. |
| 4 | `server/src/core/tools.ts` | The six tools, each a zod schema plus a pure `run`. Side effects are returned as *effects*. |
| 5 | `server/src/core/proposals.ts` + `tickets.ts` | Confirm / cancel in code (no LLM), payment card, booking reference, tickets. |
| 6 | `server/src/core/llm/*` | Provider-neutral `Llm` interface, Gemini adapter, fallback and retry. |
| 7 | `server/src/core/travelService.ts` | The only entry point channels use: conversations, messages, bookings, decisions. |
| 8 | `server/src/channels/web.router.ts` + `http/errorHandler.middleware.ts` | Thin HTTP adapter and central error mapping. |
| 9 | `server/src/channels/slack.*` | Thin Slack adapter: events → service calls; Block Kit rendering. |
| 10 | `web/src/useChat.ts` | All web state: sending, retry, switching chats, proposals, bookings. |
| 11 | `web/src/components/*` | Presentation only. `ProposalCard` + `TripTickets` are the booking UI. |

## Decisions

Each entry: **decision** — why — alternatives considered — where.

### Architecture

- **One backend, channels as thin adapters.** `core/` never imports a channel; web and Slack only translate input and output. Adding a channel means one new adapter. *Alternative:* separate services per channel (more deployment, duplicated logic). *Where:* `server/src/core`, `server/src/channels`.
- **Shared types package.** Server and web import the same `ChatMessage` / `ProposalView` types, and request schemas use `satisfies z.ZodType<…>`, so a contract change breaks the build instead of production. *Alternative:* OpenAPI generation (heavier for this size). *Where:* `shared/src/api.ts`, `web.router.ts`.
- **One service facade for channels.** Web and Slack call `TravelService`, never the store or the assistant directly, so ownership and visibility rules live in core. *Alternative:* channels reading the store themselves (rules spread across adapters). *Where:* `core/travelService.ts`.
- **The store owns its writes.** Reads return copies; a turn or a decision is saved with one `commit` (history, messages, proposals, preferences, booking). Swapping in a database means implementing `ConversationStore` with one transaction per `commit`. *Alternative:* mutating shared objects (works only in memory). *Where:* `store.ts`.
- **Express 5.** Standard, readable, async errors handled natively. *Alternative:* Fastify (faster, schema-first; irrelevant at this scale). *Where:* `server/src/app.ts`.

### Conversation handling

- **Users vs conversations.** Bookings and preferences belong to the user; LLM history to the conversation. A new chat starts clean but still knows your trips. *Where:* `store.ts`.
- **Ownership on every read, same 404 for "missing" and "not yours".** Prevents probing other users' ids. *Where:* `store.getConversation`.
- **Commit on success.** The loop works on a copy of history; tool side effects (proposal, preferences) are collected as effects and saved in one `store.commit` only after every LLM call succeeds. A failure mid-turn leaves no orphan proposal, no half-written history, no unsaved user message — so retry is clean. *Alternative:* write as you go and roll back (more error-prone). *Where:* `assistant.runTurn`, `summarizeEffects`.
- **One turn at a time per conversation (`TurnLock`).** A second message or a button decision during a turn gets "still working" instead of racing and corrupting history. The lock is runtime state, kept out of the stored conversation. *Alternative:* queue messages (better UX, more complexity) — listed as an improvement. *Where:* `core/turnLock.ts`, `assistant.handleMessage`.
- **History window of 24 messages starting at a user message.** Bounds cost and respects Gemini's rule that history cannot start with a tool result. *Where:* `recentHistory`.

### The agent

- **Freedom with grounding.** The model may use general travel knowledge (packing, food, itineraries), but anything bookable or priced must come from tools. *Why:* a helpful assistant that never invents prices. *Where:* `buildSystemPrompt`.
- **Prices computed in code**, never by the model (nightly rate × nights × rooms, fare × travelers). *Where:* `tools.buildProposal`.
- **Deterministic flight offers.** Derived from a hash of route and date, so `propose_trip` re-creates the chosen offer without storing searches; each search includes a Google Flights link for the same trip. *Where:* `core/flights.ts`.
- **Manual tool loop (capped at 6 steps) instead of a framework.** Easy to read and explain; the cap prevents runaway loops. *Where:* `assistant.runToolLoop`.
- **Quick replies as a parsed last line.** Cheaper than an extra tool call; if the model omits it, the reply simply has no chips. *Where:* `extractQuickReplies`.
- **Destination cards from real tool results**, not from the model's text, so they are always accurate. *Where:* `findSuggestedDestinations`.

### Booking and payment

- **Propose, then confirm in code.** The LLM can only create a proposal; confirm/cancel (button, chip or typed "confirm") never calls the LLM. Idempotent: a double click or Slack retry books once; a cancelled or replaced proposal cannot be booked. *Where:* `proposals.decide`, `assistant.resolveProposal`.
- **Saved cards instead of a card form.** A public demo with a card form invites real card numbers, an LLM should never see payment data, and saved cards are how real booking apps work after the first purchase. *Where:* `SAVED_PAYMENT_METHODS` in `shared/src/api.ts`, `ProposalCard`.
- **Tickets issued on confirmation**: airline booking code, e-ticket per traveler, seats together, outbound and return legs, hotel voucher, calendar file. *Why:* the booking must feel complete. *Where:* `core/tickets.ts`, `TripTickets.tsx`, `calendar.util.ts`.
- **No links to real airlines or hotels.** Partners are fictional; linking to a real company would claim a booking that does not exist. The only external link is the Google Flights price comparison.

### Reliability

- **Failures are chat messages (HTTP 200 + `error.kind`)**, with a retryable flag; HTTP 4xx/5xx are reserved for API misuse. *Where:* `ERROR_REPLIES`, `errorHandler.middleware.ts`.
- **Fallback and retry for the free tier.** Primary model → second lite model → primary again after 1.5 s, only for rate-limit/overload errors. *Where:* `llm/fallbackLlm.ts`.
- **Duplicate events.** Slack events, quick-reply clicks and New trip clicks are deduplicated by timestamp in a bounded set. *Where:* `channels/seenEvents.ts`, `slack.handlers.ts`.
- **Slack output escaping.** `&`, `<`, `>` are escaped so model text cannot ping `@channel`. *Where:* `toSlackMrkdwn`.

### Slack

- **Socket Mode.** No public URL or request signing; works from a laptop and from Render. *Where:* `slack.bot.ts`.
- **Flat DM with "New trip" instead of threads.** Threads hid replies and a follow-up outside the thread silently started a new chat. *Trade-off:* old trips are separated only by the "New trip" marker, and an earlier trip cannot be continued from Slack (listed as an improvement). *Where:* `slack.handlers.ts` (`currentSessions`).
- **Non-rotating app token.** Rotating tokens expire every 12 h and need single-use refresh tokens that a free instance cannot persist. *Where:* `slack-app-manifest.yml`, `config.ts`.

### Web

- **One hook owns state (`useChat`)**; components only render. Replies arriving after you switch chats are ignored, and retry removes exactly the failed pair by id. *Where:* `web/src/useChat.ts`.
- **Design.** Fraunces serif + DM Sans, one terracotta accent, boarding-pass card, light by default. *Where:* `theme.ts`, `styles.css`, `*.module.css`.

### Deployment

- **Render free tier, one service** (API + web + Slack), Node 22 pinned, uptime ping to stay awake. *Trade-off:* in-memory data resets on restart. *Where:* `render.yaml`, `docs/deploy.md`.

## Review status

A deep review found 10 issues; 8 are fixed (cancelled cards saying "Paid with", long Slack replies, return flights before check-out, Slack card updates, the calendar download, payment-id validation, React keys, empty replies). The two time-zone issues are documented as known limitations in the README.

### Booking experience

- **Booking progress is presentational.** The server confirms instantly; the web card and the Slack card show four steps (seats, hotel, payment, tickets) for about 3.6 seconds so the booking reads as a real transaction. The minimum duration lives in one place per channel (`useChat.resolveProposal`, `slack.handlers.showBookingProgress`) and is skipped in tests.
