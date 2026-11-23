import { LlmError, type Llm, type LlmReply, type LlmRequest } from './types.js';

export class FallbackLlm implements Llm {
  constructor(
    private readonly primary: Llm,
    private readonly fallback: Llm,
  ) {}

  async generate(request: LlmRequest): Promise<LlmReply> {
    try {
      return await this.primary.generate(request);
    } catch (error) {
      if (error instanceof LlmError && error.kind === 'rate_limit') {
        return this.fallback.generate(request);
      }
      throw error;
    }
  }
}
