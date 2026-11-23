import { ApiError, BlockedReason, FinishReason, type Part } from '@google/genai';
import { describe, expect, it } from 'vitest';
import { FallbackLlm } from '../src/core/llm/fallbackLlm.js';
import { toGeminiContents, toLlmError, toLlmReply } from '../src/core/llm/gemini.js';
import { LlmError, type Llm, type LlmReply } from '../src/core/llm/types.js';

function replyWithParts(parts: Part[], finishReason = FinishReason.STOP) {
  return { candidates: [{ content: { role: 'model', parts }, finishReason }] };
}

describe('toLlmReply', () => {
  it('extracts text and keeps the raw parts', () => {
    const parts: Part[] = [{ text: 'Hello ' }, { text: 'there' }];

    expect(toLlmReply(replyWithParts(parts))).toEqual({ text: 'Hello there', toolCalls: [], raw: parts });
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

  it('sends raw assistant parts back unchanged so thought signatures survive', () => {
    const raw: Part[] = [{ functionCall: { name: 'list_bookings', args: {} }, thoughtSignature: 'sig-123' }];

    const [content] = toGeminiContents([{ role: 'assistant', toolCalls: [], raw }]);

    expect(content?.parts).toBe(raw);
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
});

describe('FallbackLlm', () => {
  const okReply: LlmReply = { text: 'from fallback', toolCalls: [] };
  const request = { system: '', messages: [], tools: [] };

  function failingLlm(error: Error): Llm {
    return { generate: () => Promise.reject(error) };
  }

  it('uses the fallback model when the primary is rate limited', async () => {
    const llm = new FallbackLlm(failingLlm(new LlmError('rate_limit', '429')), {
      generate: () => Promise.resolve(okReply),
    });

    await expect(llm.generate(request)).resolves.toBe(okReply);
  });

  it('does not use the fallback for other failures', async () => {
    const llm = new FallbackLlm(failingLlm(new LlmError('unavailable', '503')), {
      generate: () => Promise.resolve(okReply),
    });

    await expect(llm.generate(request)).rejects.toMatchObject({ kind: 'unavailable' });
  });
});
