import { loadConfig } from '../src/config.js';
import { TripAssistant } from '../src/core/assistant.js';
import { createGeminiLlm } from '../src/core/llm/gemini.js';
import { InMemoryConversationStore } from '../src/core/store.js';

const config = loadConfig();
const store = new InMemoryConversationStore();
const assistant = new TripAssistant({
  store,
  llm: createGeminiLlm({ apiKey: config.GEMINI_API_KEY, model: config.LLM_MODEL, fallbackModel: config.LLM_FALLBACK_MODEL }),
});

const userId = 'cli:smoke';
const conversation = store.createConversation(userId);
const turns = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      'I want a warm beach trip in February, mid budget.',
      'Tell me more about the first one.',
      'Book it for 2 travelers, 5 nights starting March 3 next year.',
    ];

for (const text of turns) {
  console.log(`\n> ${text}`);
  const { reply, updatedProposal } = await assistant.handleMessage(userId, conversation.id, text);
  console.log(reply.text);
  if (reply.proposal) console.log('  [proposal]', JSON.stringify(reply.proposal));
  if (updatedProposal) console.log('  [updated]', updatedProposal.id, updatedProposal.status);
  if (reply.error) console.log('  [error]', JSON.stringify(reply.error));
}

const toolCalls = store.getConversation(userId, conversation.id).llmHistory.flatMap((message) =>
  message.role === 'assistant' ? message.toolCalls.map(({ name, args }) => `${name}(${JSON.stringify(args)})`) : [],
);
console.log('\nTool calls:', toolCalls.join(', ') || 'none');
