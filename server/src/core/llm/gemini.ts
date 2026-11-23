import { randomUUID } from 'node:crypto';
import {
  ApiError,
  FinishReason,
  GoogleGenAI,
  type Content,
  type GenerateContentResponse,
  type Part,
  type Tool,
} from '@google/genai';
import { FallbackLlm } from './fallbackLlm.js';
import {
  LlmError,
  type Llm,
  type LlmMessage,
  type LlmReply,
  type LlmRequest,
  type ToolCall,
  type ToolSpec,
} from './types.js';

const REQUEST_TIMEOUT_MS = 20_000;

// Gemini may omit function call ids; ours are prefixed so they are never sent back as if Gemini issued them.
const LOCAL_CALL_ID_PREFIX = 'local-';

const BLOCKED_FINISH_REASONS = new Set<FinishReason>([
  FinishReason.SAFETY,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.BLOCKLIST,
  FinishReason.SPII,
  FinishReason.RECITATION,
]);

export interface GeminiSettings {
  apiKey: string;
  model: string;
  fallbackModel?: string;
}

export function createGeminiLlm({ apiKey, model, fallbackModel }: GeminiSettings): Llm {
  const client = new GoogleGenAI({ apiKey });
  const primary = new GeminiLlm(client, model);
  return fallbackModel ? new FallbackLlm(primary, new GeminiLlm(client, fallbackModel)) : primary;
}

export class GeminiLlm implements Llm {
  constructor(
    private readonly client: GoogleGenAI,
    private readonly model: string,
  ) {}

  async generate({ system, messages, tools }: LlmRequest): Promise<LlmReply> {
    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: toGeminiContents(messages),
        config: {
          systemInstruction: system,
          tools: toGeminiTools(tools),
          httpOptions: { timeout: REQUEST_TIMEOUT_MS },
        },
      });
      return toLlmReply(response);
    } catch (error) {
      throw toLlmError(error);
    }
  }
}

export function toGeminiContents(messages: LlmMessage[]): Content[] {
  return messages.map(toGeminiContent);
}

function toGeminiContent(message: LlmMessage): Content {
  switch (message.role) {
    case 'user':
      return { role: 'user', parts: [{ text: message.text }] };
    case 'assistant':
      return { role: 'model', parts: isPartList(message.raw) ? message.raw : toAssistantParts(message) };
    case 'tool':
      return {
        role: 'user',
        parts: message.results.map(({ callId, name, output, isError }) => ({
          functionResponse: {
            id: callId.startsWith(LOCAL_CALL_ID_PREFIX) ? undefined : callId,
            name,
            response: isError ? { error: output } : { output },
          },
        })),
      };
  }
}

function toAssistantParts({ text, toolCalls }: { text?: string; toolCalls: ToolCall[] }): Part[] {
  const textParts: Part[] = text ? [{ text }] : [];
  const callParts: Part[] = toolCalls.map(({ name, args }) => ({
    functionCall: { name, args: isRecord(args) ? args : {} },
  }));
  return [...textParts, ...callParts];
}

function toGeminiTools(tools: ToolSpec[]): Tool[] | undefined {
  if (tools.length === 0) return undefined;
  return [
    {
      functionDeclarations: tools.map(({ name, description, parameters }) => ({
        name,
        description,
        parametersJsonSchema: parameters,
      })),
    },
  ];
}

export function toLlmReply(response: Pick<GenerateContentResponse, 'candidates' | 'promptFeedback'>): LlmReply {
  if (response.promptFeedback?.blockReason) {
    throw new LlmError('blocked', `Prompt blocked: ${response.promptFeedback.blockReason}`);
  }

  const candidate = response.candidates?.[0];
  if (candidate?.finishReason && BLOCKED_FINISH_REASONS.has(candidate.finishReason)) {
    throw new LlmError('blocked', `Response blocked: ${candidate.finishReason}`);
  }

  const parts = candidate?.content?.parts ?? [];
  const text = parts
    .filter((part) => part.text && !part.thought)
    .map((part) => part.text)
    .join('');
  const toolCalls = parts.flatMap((part, index): ToolCall[] => {
    const call = part.functionCall;
    if (!call?.name) return [];
    return [{ id: call.id ?? `${LOCAL_CALL_ID_PREFIX}${index}-${randomUUID()}`, name: call.name, args: call.args ?? {} }];
  });

  if (!text && toolCalls.length === 0) {
    throw new LlmError('blocked', `Empty response (finish reason: ${candidate?.finishReason ?? 'none'})`);
  }

  return { text: text || undefined, toolCalls, raw: parts };
}

export function toLlmError(error: unknown): LlmError {
  if (error instanceof LlmError) return error;
  if (error instanceof ApiError) {
    if (error.status === 429) return new LlmError('rate_limit', error.message);
    if (error.status >= 500) return new LlmError('unavailable', error.message);
    return new LlmError('bad_request', error.message);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new LlmError('unavailable', message);
}

function isPartList(value: unknown): value is Part[] {
  return Array.isArray(value) && value.every(isRecord);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
