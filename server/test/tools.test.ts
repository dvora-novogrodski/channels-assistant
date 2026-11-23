import { describe, expect, it } from 'vitest';
import { InMemoryConversationStore } from '../src/core/store.js';
import { executeToolCall, toolSpecs, type ToolContext } from '../src/core/tools.js';

function createContext(): ToolContext {
  const store = new InMemoryConversationStore();
  const conversation = store.createConversation('web:alice');
  return { user: store.getUser('web:alice'), conversation, today: '2027-01-10' };
}

function call(name: string, args: unknown) {
  return executeToolCall({ id: 'call-1', name, args }, createContext());
}

describe('tool specs', () => {
  it('exposes plain JSON schemas without the $schema key', () => {
    expect(toolSpecs.map(({ name }) => name)).toEqual([
      'search_destinations',
      'get_destination',
      'propose_booking',
      'list_bookings',
    ]);
    for (const { parameters } of toolSpecs) {
      expect(parameters).not.toHaveProperty('$schema');
      expect(parameters).toMatchObject({ type: 'object' });
    }
  });
});

describe('executeToolCall', () => {
  it('searches destinations with validated filters', () => {
    const { result } = call('search_destinations', { region: 'Oceania' });

    expect(result.isError).toBeUndefined();
    expect(result.output).toMatchObject({ totalMatches: 2 });
  });

  it('returns a readable error for invalid arguments', () => {
    const { result } = call('search_destinations', { month: 13 });

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/^Invalid arguments\. month:/);
  });

  it('returns an error for an unknown destination', () => {
    const { result } = call('get_destination', { destinationId: 'atlantis-xx' });

    expect(result).toMatchObject({ isError: true, output: expect.stringContaining('Unknown destinationId') });
  });

  it('returns an error for an unknown tool', () => {
    expect(call('book_flight', {}).result).toMatchObject({ isError: true, output: 'Unknown tool "book_flight".' });
  });

  it('proposes a booking with a price computed in code and an effect, without booking', () => {
    const context = createContext();
    const { result, effect } = executeToolCall(
      { id: 'call-1', name: 'propose_booking', args: { destinationId: 'lisbon-pt', startDate: '2027-05-12', nights: 5, travelers: 2 } },
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(effect?.proposal).toMatchObject({
      destinationName: 'Lisbon',
      endDate: '2027-05-17',
      estimatedTotalUsd: 140 * 5 * 2,
      status: 'proposed',
    });
    expect(context.user.bookings).toEqual([]);
    expect(context.conversation.proposals).toEqual([]);
  });

  it('rejects a start date in the past', () => {
    const { result, effect } = call('propose_booking', {
      destinationId: 'lisbon-pt',
      startDate: '2026-12-01',
      nights: 3,
      travelers: 1,
    });

    expect(result).toMatchObject({ isError: true, output: expect.stringContaining('is in the past') });
    expect(effect).toBeUndefined();
  });
});
