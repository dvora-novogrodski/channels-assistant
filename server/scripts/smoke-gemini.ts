import { loadConfig } from '../src/config.js';
import { createGeminiLlm } from '../src/core/llm/gemini.js';
import type { LlmMessage, ToolSpec } from '../src/core/llm/types.js';

const config = loadConfig();
const llm = createGeminiLlm({
  apiKey: config.GEMINI_API_KEY,
  model: config.LLM_MODEL,
  fallbackModel: config.LLM_FALLBACK_MODEL,
});

const getWeather: ToolSpec = {
  name: 'get_weather',
  description: 'Get the current weather for a city.',
  parameters: {
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
  },
};

const messages: LlmMessage[] = [{ role: 'user', text: 'What is the weather in Lisbon?' }];
const request = { system: 'You are a concise assistant. Use tools when helpful.', tools: [getWeather] };

const first = await llm.generate({ ...request, messages });
console.log(`[${config.LLM_MODEL}] tool calls:`, JSON.stringify(first.toolCalls));

const call = first.toolCalls[0];
if (!call) {
  console.log('No tool call; text reply:', first.text);
  process.exit(0);
}

messages.push(
  { role: 'assistant', text: first.text, toolCalls: first.toolCalls, raw: first.raw },
  { role: 'tool', results: [{ callId: call.id, name: call.name, output: { tempC: 21, sky: 'sunny' } }] },
);

const second = await llm.generate({ ...request, messages });
console.log('Final reply:', second.text);
