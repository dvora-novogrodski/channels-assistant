// Captions shown under the recordings. Each one starts at a mark recorded by record-web.mjs / record-slack.mjs
// and lasts until the next caption of the same clip (or the clip's end). Edit the text here, then run `npm run compose`.
export const CAPTIONS = {
  web: [
    { at: 'home', title: 'The web chat', sub: 'React + TypeScript, talking to the shared Express backend' },
    { at: 'send:search', title: 'Ask in plain language', sub: 'Gemini calls the <code>search_destinations</code> tool' },
    { at: 'cards', title: 'Cards come from tool results', sub: 'Prices and seasons are real data, not invented by the model' },
    { at: 'send:followup', title: 'A contextual follow-up', sub: '“the first one” is resolved from the conversation history' },
    { at: 'send:book', title: 'Ask to book', sub: '<code>search_flights</code> and <code>propose_trip</code> prepare a proposal' },
    { at: 'proposal', title: 'Nothing is booked without confirmation', sub: 'Confirm & pay with a saved card is handled in code, not by the model' },
    { at: 'booking-progress', title: 'Booking progress, then e-tickets', sub: 'Record locator, seats and a hotel voucher' },
    { at: 'confirmation', title: 'A structured confirmation', sub: 'The trip now appears under “My trips”' },
    { at: 'send:failure', title: 'When the AI service fails', sub: 'The error becomes a clear message with Try again' },
    { at: 'send:recovery', title: 'The conversation is intact', sub: 'The next message works, and <code>list_bookings</code> finds the trip' },
  ],
  isolation: [{ at: 'start', title: 'A second visitor starts empty', sub: 'Each user has their own conversations and bookings' }],
  slack: [
    { at: 'start', title: '“new trip” starts a fresh conversation', sub: 'Slack DMs are one flat chat, so this resets the context' },
    { at: 'send:search', title: 'Native Block Kit cards', sub: 'The same tools, rendered for Slack' },
    { at: 'send:plan', title: 'Buttons instead of typing', sub: '“Plan this trip” sends the request for you' },
    { at: 'proposal', title: 'Confirm & pay in Slack', sub: 'The same confirmation rules as the web' },
    { at: 'booking-progress', title: 'Booked from Slack', sub: 'The card updates in place, then shows the tickets' },
  ],
};

export const TEXT = {
  title: 'Travel Assistant',
  tagline: 'One AI travel assistant, on the web and in Slack',
  author: 'Dvora',
  slackIntro: 'Same backend, another channel',
  slackIntroTitle: 'Now in Slack',
  liveUrl: 'travel-assistant-caod.onrender.com',
  repoUrl: 'github.com/dvora-novogrodski/channels-assistant',
  webBar: 'travel-assistant-caod.onrender.com',
  slackBar: 'Slack · Travel Assistant',
};
