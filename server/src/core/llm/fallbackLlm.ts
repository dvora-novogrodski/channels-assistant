import { LlmError, type Llm, type LlmErrorKind, type LlmReply, type LlmRequest } from './types.js';

export const RETRY_DELAY_MS = 1500;

const RETRYABLE_KINDS = new Set<LlmErrorKind>(['rate_limit', 'unavailable']);

type Sleep = (milliseconds: number) => Promise<void>;

const defaultSleep: Sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function isRetryable(error: unknown): boolean {
  return error instanceof LlmError && RETRYABLE_KINDS.has(error.kind);
}

export class FallbackLlm implements Llm {
  constructor(
    private readonly attempts: Llm[],
    private readonly sleep: Sleep = defaultSleep,
    private readonly retryDelayMs = RETRY_DELAY_MS,
  ) {}

  async generate(request: LlmRequest): Promise<LlmReply> {
    let lastError: unknown = new LlmError('unavailable', 'No LLM configured');
    for (const [index, llm] of this.attempts.entries()) {
      if (index >= 2) await this.sleep(this.retryDelayMs);
      try {
        return await llm.generate(request);
      } catch (error) {
        if (!isRetryable(error)) throw error;
        lastError = error;
      }
    }
    throw lastError;
  }
}
