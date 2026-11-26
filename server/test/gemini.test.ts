import { ApiError, BlockedReason, FinishReason, type Part } from '@google/genai';
import { describe, expect, it } from 'vitest';
import { FallbackLlm } from '../src/core/llm/fallbackLlm.js';
import { toGeminiContents, toLlmError, toLlmReply } from '../src/core/llm/gemini.js';
import { LlmError, type Llm, type LlmReply } from '../src/core/llm/types.js';

function replyWithParts(parts: Part[], finishReason = FinishReason.STOP) {
  return { candidates: [{ content: { role: 'model', parts }, finishReason }] };
}

describe('toLlmReply', () => {
  it('extracts text and keeps the provider parts', () => {
    const parts: Part[] = [{ text: 'Hello ' }, { text: 'there' }];

    expect(toLlmReply(replyWithParts(parts))).toEqual({ text: 'Hello there', toolCalls: [], providerParts: parts });
  });

  it('extracts tool calls and ignores thought text', () => {
    const parts: Part[] = [
      { text: 'thinking...', thought: true },
      { functionCall: { id: 'call-1', name: 'search_destinations', args: { month: 3 } }, thoughtSignature: 'sig' },
    ];

    const reply = toLlmReply(replyWithParts(parts));

    expect(reply.text).toBeUndefined();
    expect(reply.toolCalls).toEqual([{ id: 'call-1', name: 'search_destinations', args: { month: 3 } }]);
  });

  it('generates a local id when Gemini omits one', () => {
    const reply = toLlmReply(replyWithParts([{ functionCall: { name: 'list_bookings' } }]));

    expect(reply.toolCalls[0]?.id).toMatch(/^local-/);
    expect(reply.toolCalls[0]?.args).toEqual({});
  });

  it('treats safety stops and blocked prompts as blocked', () => {
    expect(() => toLlmReply(replyWithParts([], FinishReason.SAFETY))).toThrow(
      expect.objectContaining({ kind: 'blocked' }),
    );
    expect(() => toLlmReply({ promptFeedback: { blockReason: BlockedReason.SAFETY } })).toThrow(
      expect.objectContaining({ kind: 'blocked' }),
    );
  });

  it('treats an empty response as blocked', () => {
    expect(() => toLlmReply({ candidates: [] })).toThrow(expect.objectContaining({ kind: 'blocked' }));
  });
});

describe('toGeminiContents', () => {
  it('maps user, assistant and tool messages to Gemini roles', () => {
    const contents = toGeminiContents([
      { role: 'user', text: 'Warm places in March?' },
      { role: 'assistant', toolCalls: [{ id: 'call-1', name: 'search_destinations', args: { month: 3 } }] },
      { role: 'tool', results: [{ callId: 'call-1', name: 'search_destinations', output: { results: [] } }] },
    ]);

    expect(contents).toEqual([
      { role: 'user', parts: [{ text: 'Warm places in March?' }] },
      { role: 'model', parts: [{ functionCall: { name: 'search_destinations', args: { month: 3 } } }] },
      {
        role: 'user',
        parts: [{ functionResponse: { id: 'call-1', name: 'search_destinations', response: { output: { results: [] } } } }],
      },
    ]);
  });

  it('sends provider parts back unchanged so thought signatures survive', () => {
    const providerParts: Part[] = [{ functionCall: { name: 'list_bookings', args: {} }, thoughtSignature: 'sig-123' }];

    const [content] = toGeminiContents([{ role: 'assistant', toolCalls: [], providerParts }]);

    expect(content?.parts).toBe(providerParts);
  });

  it('marks tool errors and drops locally generated call ids', () => {
    const [content] = toGeminiContents([
      { role: 'tool', results: [{ callId: 'local-0-abc', name: 'get_destination', output: 'Unknown id', isError: true }] },
    ]);

    expect(content?.parts).toEqual([
      { functionResponse: { id: undefined, name: 'get_destination', response: { error: 'Unknown id' } } },
    ]);
  });
});

describe('toLlmError', () => {
  it.each([
    [429, 'rate_limit'],
    [503, 'unavailable'],
    [400, 'bad_request'],
    [403, 'bad_request'],
  ])('maps HTTP %i to %s', (status, kind) => {
    expect(toLlmError(new ApiError({ status, message: 'x' })).kind).toBe(kind);
  });

  it('maps network errors and timeouts to unavailable', () => {
    expect(toLlmError(new TypeError('fetch failed')).kind).toBe('unavailable');
  });

  it('includes the underlying network cause in the message', () => {
    const cause = Object.assign(new Error('getaddrinfo ENOTFOUND example.com'), { code: 'ENOTFOUND' });

    expect(toLlmError(new TypeError('fetch failed', { cause })).message).toBe(
      'fetch failed: getaddrinfo ENOTFOUND example.com [ENOTFOUND]',
    );
  });
});

describe('FallbackLlm', () => {
  const okReply: LlmReply = { text: 'from fallback', toolCalls: [] };
  const request = { system: '', messages: [], tools: [] };

  const succeeding: Llm = { generate: () => Promise.resolve(okReply) };
  const noWait = () => Promise.resolve();

  function failingLlm(error: Error): Llm {
    return { generate: () => Promise.reject(error) };
  }

  function sequenceLlm(...outcomes: Array<LlmReply | Error>): Llm & { calls: number } {
    const llm = {
      calls: 0,
      generate: () => {
        const outcome = outcomes[llm.calls++];
        return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome ?? okReply);
      },
    };
    return llm;
  }

  it.each(['rate_limit', 'unavailable'] as const)('uses the fallback model when the primary fails with %s', async (kind) => {
    const llm = new FallbackLlm([failingLlm(new LlmError(kind, 'primary failed')), succeeding], noWait);

    await expect(llm.generate(request)).resolves.toBe(okReply);
  });

  it.each(['blocked', 'bad_request'] as const)('does not use the fallback for %s', async (kind) => {
    const llm = new FallbackLlm([failingLlm(new LlmError(kind, 'primary failed')), succeeding], noWait);

    await expect(llm.generate(request)).rejects.toMatchObject({ kind });
  });

  it('waits and retries the primary when both models are overloaded', async () => {
    const primary = sequenceLlm(new LlmError('unavailable', '503'), okReply);
    const waits: number[] = [];
    const llm = new FallbackLlm(
      [primary, failingLlm(new LlmError('unavailable', '504')), primary],
      async (milliseconds) => {
        waits.push(milliseconds);
      },
      1500,
    );

    await expect(llm.generate(request)).resolves.toBe(okReply);
    expect(primary.calls).toBe(2);
    expect(waits).toEqual([1500]);
  });

  it('reports the last error when every attempt fails', async () => {
    const llm = new FallbackLlm(
      [failingLlm(new LlmError('unavailable', 'first')), failingLlm(new LlmError('rate_limit', 'last'))],
      noWait,
    );

    await expect(llm.generate(request)).rejects.toMatchObject({ kind: 'rate_limit', message: 'last' });
  });
});
