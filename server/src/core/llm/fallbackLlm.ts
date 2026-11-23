import { LlmError, type Llm, type LlmErrorKind, type LlmReply, type LlmRequest } from './types.js';

// Free-tier quota and "high demand" 503s are per model, so another model often succeeds.
const RETRYABLE_KINDS = new Set<LlmErrorKind>(['rate_limit', 'unavailable']);

export class FallbackLlm implements Llm {
  constructor(
    private readonly primary: Llm,
    private readonly fallback: Llm,
  ) {}

  async generate(request: LlmRequest): Promise<LlmReply> {
    try {
      return await this.primary.generate(request);
    } catch (error) {
      if (error instanceof LlmError && RETRYABLE_KINDS.has(error.kind)) {
        return this.fallback.generate(request);
      }
      throw error;
    }
  }
}
