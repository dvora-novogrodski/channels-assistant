import path from 'node:path';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { TripAssistant } from './core/assistant.js';
import { createGeminiLlm } from './core/llm/gemini.js';
import { InMemoryConversationStore } from './core/store.js';

const config = loadConfig();

const store = new InMemoryConversationStore();
const llm = createGeminiLlm({
  apiKey: config.GEMINI_API_KEY,
  model: config.LLM_MODEL,
  fallbackModel: config.LLM_FALLBACK_MODEL,
});
const assistant = new TripAssistant({ store, llm, demoFailures: config.DEMO_FAILURES });

const app = createApp({
  store,
  assistant,
  webDistPath: path.resolve(import.meta.dirname, '../../web/dist'),
});

app.listen(config.PORT, () => {
  const fallback = config.LLM_FALLBACK_MODEL ? `, fallback ${config.LLM_FALLBACK_MODEL}` : '';
  console.log(`Server listening on http://localhost:${config.PORT} (model ${config.LLM_MODEL}${fallback})`);
});
