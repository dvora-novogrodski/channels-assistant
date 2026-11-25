import { describe, expect, it } from 'vitest';
import { searchFlights } from '../src/core/flights.js';
import { InMemoryConversationStore } from '../src/core/store.js';
import { DEMO_PAYMENT_METHOD, executeToolCall, toolSpecs, type ToolContext } from '../src/core/tools.js';
import { LISBON_TRIP } from './fixtures.js';

function createContext(): ToolContext {
  const store = new InMemoryConversationStore();
  const conversation = store.createConversation('web:alice');
  return { user: store.getUser('web:alice'), conversation, today: '2027-01-10' };
}

function call(name: string, args: unknown, context = createContext()) {
  return executeToolCall({ id: 'call-1', name, args }, context);
}

function lisbonFlightOffer() {
  return searchFlights({ originAirport: 'TLV', destinationAirport: 'LIS', departDate: '2027-05-12', returnDate: '2027-05-17' });
}

describe('tool specs', () => {
  it('exposes plain JSON schemas without the $schema key', () => {
    expect(toolSpecs.map(({ name }) => name)).toEqual([
      'search_destinations',
      'get_destination',
      'search_flights',
      'propose_trip',
      'list_bookings',
      'save_preferences',
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

  it('returns destination details including stays and the airport', () => {
    const { result } = call('get_destination', { destinationId: 'lisbon-pt' });

    expect(result.output).toMatchObject({ airportCode: 'LIS', stays: expect.arrayContaining([expect.objectContaining({ id: 'lisbon-pt-stay-1' })]) });
  });

  it('returns an error for an unknown destination or tool', () => {
    expect(call('get_destination', { destinationId: 'atlantis-xx' }).result).toMatchObject({
      isError: true,
      output: expect.stringContaining('Unknown destinationId'),
    });
    expect(call('book_flight', {}).result).toMatchObject({ isError: true, output: 'Unknown tool "book_flight".' });
  });

  it('finds deterministic demo flights with a real compare link', () => {
    const first = call('search_flights', { ...LISBON_TRIP, originAirport: 'tlv' }).result.output;
    const second = call('search_flights', { ...LISBON_TRIP, originAirport: 'TLV' }).result.output;

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      demo: true,
      offers: expect.arrayContaining([expect.objectContaining({ originAirport: 'TLV', destinationAirport: 'LIS' })]),
      compareUrl: expect.stringMatching(/^https:\/\/www\.google\.com\/travel\/flights\?q=Flights%20from%20TLV%20to%20LIS/),
    });
  });

  it('proposes a stay-only package priced in code, without booking', () => {
    const context = createContext();
    const { result, effect } = call('propose_trip', LISBON_TRIP, context);

    expect(result.isError).toBeUndefined();
    expect(effect).toMatchObject({
      type: 'propose',
      proposal: {
        destinationName: 'Lisbon',
        endDate: '2027-05-17',
        stay: { name: 'Alfama Tile House', rooms: 1 },
        costs: { stayUsd: 85 * 5, flightsUsd: 0 },
        estimatedTotalUsd: 425,
        paymentMethod: DEMO_PAYMENT_METHOD,
        status: 'proposed',
      },
    });
    expect(context.user.bookings).toEqual([]);
    expect(context.conversation.proposals).toEqual([]);
  });

  it('adds the chosen demo flight and stay to the package', () => {
    const [offer] = lisbonFlightOffer().offers;
    const { effect } = call('propose_trip', {
      ...LISBON_TRIP,
      travelers: 3,
      stayId: 'lisbon-pt-stay-2',
      originAirport: 'TLV',
      flightOfferId: offer?.id,
    });

    expect(effect).toMatchObject({
      proposal: {
        stay: { name: 'Tagus View Suites', rooms: 2 },
        flight: { airline: offer?.airline, compareUrl: expect.stringContaining('google.com/travel/flights') },
        costs: { stayUsd: 190 * 5 * 2, flightsUsd: (offer?.priceUsdPerTraveler ?? 0) * 3 },
      },
    });
  });

  it('rejects unknown stays and flights with the valid options', () => {
    expect(call('propose_trip', { ...LISBON_TRIP, stayId: 'nope' }).result.output).toContain('Valid stay ids: lisbon-pt-stay-1');
    expect(call('propose_trip', { ...LISBON_TRIP, originAirport: 'TLV', flightOfferId: 'nope' }).result.output).toContain(
      'Call search_flights',
    );
  });

  it('rejects a start date in the past', () => {
    const { result, effect } = call('propose_trip', { ...LISBON_TRIP, startDate: '2026-12-01' });

    expect(result).toMatchObject({ isError: true, output: expect.stringContaining('is in the past') });
    expect(effect).toBeUndefined();
  });

  it('returns preferences as an effect instead of saving them directly', () => {
    const context = createContext();
    const { effect } = call('save_preferences', { homeAirport: 'tlv', travelers: 2 }, context);

    expect(effect).toEqual({ type: 'savePreferences', preferences: { homeAirport: 'TLV', travelers: 2 } });
    expect(context.user.preferences).toEqual({});
  });
});
