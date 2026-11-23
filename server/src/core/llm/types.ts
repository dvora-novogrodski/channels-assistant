export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
}

export interface ToolResult {
  callId: string;
  name: string;
  output: unknown;
  isError?: boolean;
}

export type LlmMessage =
  | { role: 'user'; text: string }
  | {
      role: 'assistant';
      text?: string;
      toolCalls: ToolCall[];
      // Provider-specific parts (e.g. Gemini thought signatures) that must be sent back unchanged.
      raw?: unknown;
    }
  | { role: 'tool'; results: ToolResult[] };

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  tools: ToolSpec[];
}

export interface LlmReply {
  text?: string;
  toolCalls: ToolCall[];
  raw?: unknown;
}

export interface Llm {
  generate(request: LlmRequest): Promise<LlmReply>;
}

export type LlmErrorKind = 'rate_limit' | 'unavailable' | 'blocked' | 'bad_request';

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}
