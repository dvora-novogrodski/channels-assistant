import type { Llm, LlmReply, LlmRequest, ToolCall } from '../src/core/llm/types.js';

type ScriptStep = LlmReply | Error | (() => Promise<LlmReply>);

export class ScriptedLlm implements Llm {
  readonly requests: LlmRequest[] = [];
  private readonly steps: ScriptStep[];

  constructor(...steps: ScriptStep[]) {
    this.steps = steps;
  }

  then(...steps: ScriptStep[]): this {
    this.steps.push(...steps);
    return this;
  }

  async generate(request: LlmRequest): Promise<LlmReply> {
    this.requests.push(structuredClone(request));
    const step = this.steps.shift();
    if (!step) throw new Error('ScriptedLlm ran out of scripted replies');
    if (step instanceof Error) throw step;
    if (typeof step === 'function') return step();
    return step;
  }
}

export function textReply(text: string): LlmReply {
  return { text, toolCalls: [] };
}

export function toolReply(...calls: Array<Omit<ToolCall, 'id'>>): LlmReply {
  return { toolCalls: calls.map((call, index) => ({ id: `call-${index}-${call.name}`, ...call })) };
}
