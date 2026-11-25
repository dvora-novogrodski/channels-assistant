import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { BUDGET_TIERS, REGIONS, SAVED_PAYMENT_METHODS, TAGS, type Destination, type Stay } from '@app/shared';
import { SEARCH_SORT_ORDERS, findDestination, searchDestinations } from './destinations.js';
import { searchFlights, type FlightOffer } from './flights.js';
import type { ToolCall, ToolResult, ToolSpec } from './llm/types.js';
import type { Conversation, Proposal, User, UserPreferences } from './store.js';

export const MAX_NIGHTS = 30;
export const MAX_TRAVELERS = 10;
export const DEFAULT_PAYMENT_METHOD: string = SAVED_PAYMENT_METHODS[0].label;

export interface ToolContext {
  user: User;
  conversation: Conversation;
  today: string;
}

export type ToolEffect =
  | { type: 'propose'; proposal: Proposal }
  | { type: 'savePreferences'; preferences: UserPreferences };

interface ToolOutcome {
  output: unknown;
  effect?: ToolEffect;
}

export interface ToolExecution {
  result: ToolResult;
  effect?: ToolEffect;
}

export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolInputError';
  }
}

interface Tool {
  spec: ToolSpec;
  run(rawArgs: unknown, context: ToolContext): ToolOutcome;
}

function defineTool<TSchema extends z.ZodType>(definition: {
  name: string;
  description: string;
  schema: TSchema;
  run: (args: z.infer<TSchema>, context: ToolContext) => ToolOutcome;
}): Tool {
  const { $schema: _ignored, ...parameters } = z.toJSONSchema(definition.schema, { io: 'input' });
  return {
    spec: { name: definition.name, description: definition.description, parameters },
    run: (rawArgs, context) => definition.run(definition.schema.parse(rawArgs), context),
  };
}

const airportCode = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, 'must be a 3-letter IATA airport code')
  .transform((code) => code.toUpperCase());

const tripSchema = z.object({
  destinationId: z.string(),
  startDate: z.iso.date(),
  nights: z.number().int().min(1).max(MAX_NIGHTS),
  travelers: z.number().int().min(1).max(MAX_TRAVELERS),
});

const searchDestinationsTool = defineTool({
  name: 'search_destinations',
  description:
    'Search the destination catalog. All filters are optional. Use `month` (1-12) for "when to go" questions and ' +
    '`sortBy: "price"` for cheapest-first results. dailyCostUsd is a typical per-person daily budget. ' +
    'Returns at most 5 summaries plus the total number of matches.',
  schema: z.object({
    month: z.number().int().min(1).max(12).optional(),
    region: z.enum(REGIONS).optional(),
    budgetTier: z.enum(BUDGET_TIERS).optional(),
    tags: z.array(z.enum(TAGS)).optional(),
    maxDays: z.number().int().positive().optional(),
    sortBy: z.enum(SEARCH_SORT_ORDERS).optional(),
  }),
  run: (filters) => ({ output: searchDestinations(filters) }),
});

const getDestinationTool = defineTool({
  name: 'get_destination',
  description:
    'Get full details for one destination: highlights, notes, best months, daily budget, airport code and the ' +
    'bookable stays (with stay ids, nightly room rates and ratings).',
  schema: z.object({ destinationId: z.string() }),
  run: ({ destinationId }) => ({ output: requireDestination(destinationId) }),
});

const searchFlightsTool = defineTool({
  name: 'search_flights',
  description:
    'Find round-trip flight offers from the user\'s airport to a destination. ' +
    'Also returns compareUrl, a Google Flights search for the same trip: always share it as a Markdown link.',
  schema: tripSchema.omit({ travelers: true }).extend({ originAirport: airportCode }),
  run: ({ destinationId, startDate, nights, originAirport }, { today }) => {
    const destination = requireDestination(destinationId);
    requireFutureDate(startDate, today);
    const { offers, compareUrl } = searchDestinationFlights(destination, originAirport, startDate, nights);
    return { output: { offers, compareUrl } };
  },
});

const proposeTripTool = defineTool({
  name: 'propose_trip',
  description:
    'Prepare a trip package for the user to confirm: a stay (stayId from get_destination; omit for the best-value ' +
    'stay) plus, optionally, a flight (originAirport + flightOfferId from search_flights). This does NOT book ' +
    'anything. The user confirms with the button or by replying "confirm", and pays with a saved card. ' +
    'Proposing again replaces the previous pending proposal.',
  schema: tripSchema.extend({
    stayId: z.string().optional(),
    originAirport: airportCode.optional(),
    flightOfferId: z.string().optional(),
  }),
  run: ({ destinationId, startDate, nights, travelers, stayId, originAirport, flightOfferId }, { today }) => {
    const destination = requireDestination(destinationId);
    requireFutureDate(startDate, today);
    const stay = pickStay(destination, stayId);
    const flight = flightOfferId ? pickFlight(destination, originAirport, startDate, nights, flightOfferId) : undefined;
    const proposal = buildProposal({ destination, stay, flight, startDate, nights, travelers });

    return {
      output: { ...proposal, note: 'Not booked yet. The user confirms and pays with a saved card on the trip card.' },
      effect: { type: 'propose', proposal },
    };
  },
});

const listBookingsTool = defineTool({
  name: 'list_bookings',
  description: "List the user's confirmed trip bookings.",
  schema: z.object({}),
  run: (_args, { user }) => ({ output: { bookings: user.bookings } }),
});

const savePreferencesTool = defineTool({
  name: 'save_preferences',
  description:
    'Remember the user\'s travel preferences for future chats: home airport, usual number of travelers, budget ' +
    'style and interests. Only include what the user actually said.',
  schema: z.object({
    homeAirport: airportCode.optional(),
    travelers: z.number().int().min(1).max(MAX_TRAVELERS).optional(),
    budgetTier: z.enum(BUDGET_TIERS).optional(),
    interests: z.array(z.string().trim().min(1).max(30)).max(6).optional(),
  }),
  run: (preferences) => ({
    output: { saved: preferences },
    effect: { type: 'savePreferences', preferences },
  }),
});

const tools = [
  searchDestinationsTool,
  getDestinationTool,
  searchFlightsTool,
  proposeTripTool,
  listBookingsTool,
  savePreferencesTool,
];

export const toolSpecs: ToolSpec[] = tools.map(({ spec }) => spec);

export function executeToolCall(call: ToolCall, context: ToolContext): ToolExecution {
  const tool = tools.find(({ spec }) => spec.name === call.name);
  if (!tool) return failure(call, `Unknown tool "${call.name}".`);

  try {
    const { output, effect } = tool.run(call.args, context);
    return { result: { callId: call.id, name: call.name, output }, effect };
  } catch (error) {
    return failure(call, describeToolError(error));
  }
}

function failure(call: ToolCall, message: string): ToolExecution {
  return { result: { callId: call.id, name: call.name, output: message, isError: true } };
}

function describeToolError(error: unknown): string {
  if (error instanceof z.ZodError) {
    const problems = error.issues.map(({ path, message }) => `${path.join('.') || 'arguments'}: ${message}`);
    return `Invalid arguments. ${problems.join('; ')}`;
  }
  if (error instanceof ToolInputError) return error.message;

  console.error('Tool failed unexpectedly', error);
  return 'The tool failed unexpectedly. Tell the user something went wrong and suggest trying again.';
}

function requireDestination(destinationId: string): Destination {
  const destination = findDestination(destinationId);
  if (!destination) {
    throw new ToolInputError(`Unknown destinationId "${destinationId}". Use search_destinations to find valid ids.`);
  }
  return destination;
}

// "today" is the server's UTC date; one day of slack keeps users west of UTC from being told today is in the past.
function requireFutureDate(startDate: string, today: string): void {
  if (startDate < addDays(today, -1)) {
    throw new ToolInputError(`startDate ${startDate} is in the past (today is ${today}).`);
  }
}

function pickStay(destination: Destination, stayId: string | undefined): Stay {
  if (!stayId) return [...destination.stays].sort((a, b) => a.nightlyRateUsd - b.nightlyRateUsd)[0] ?? missingStay();
  const stay = destination.stays.find(({ id }) => id === stayId);
  if (!stay) {
    const validIds = destination.stays.map(({ id }) => id).join(', ');
    throw new ToolInputError(`Unknown stayId "${stayId}" for ${destination.name}. Valid stay ids: ${validIds}.`);
  }
  return stay;
}

function missingStay(): never {
  throw new ToolInputError('This destination has no bookable stays.');
}

function searchDestinationFlights(destination: Destination, originAirport: string, startDate: string, nights: number) {
  if (originAirport === destination.airportCode) {
    throw new ToolInputError(`The departure airport is the destination airport (${originAirport}).`);
  }
  return searchFlights({
    originAirport,
    destinationAirport: destination.airportCode,
    departDate: startDate,
    returnDate: addDays(startDate, nights),
  });
}

function pickFlight(
  destination: Destination,
  originAirport: string | undefined,
  startDate: string,
  nights: number,
  flightOfferId: string,
): FlightOffer & { compareUrl: string } {
  if (!originAirport) throw new ToolInputError('originAirport is required when flightOfferId is given.');
  const { offers, compareUrl } = searchDestinationFlights(destination, originAirport, startDate, nights);
  const offer = offers.find(({ id }) => id === flightOfferId);
  if (!offer) {
    throw new ToolInputError(`Unknown flightOfferId "${flightOfferId}". Call search_flights with the same trip first.`);
  }
  return { ...offer, compareUrl };
}

function buildProposal(trip: {
  destination: Destination;
  stay: Stay;
  flight?: FlightOffer & { compareUrl: string };
  startDate: string;
  nights: number;
  travelers: number;
}): Proposal {
  const { destination, stay, flight, startDate, nights, travelers } = trip;
  const rooms = Math.ceil(travelers / 2);
  const stayUsd = stay.nightlyRateUsd * nights * rooms;
  const flightsUsd = flight ? flight.priceUsdPerTraveler * travelers : 0;

  return {
    id: randomUUID(),
    destinationId: destination.id,
    destinationName: destination.name,
    country: destination.country,
    startDate,
    endDate: addDays(startDate, nights),
    nights,
    travelers,
    stay: { name: stay.name, type: stay.type, rating: stay.rating, nightlyRateUsd: stay.nightlyRateUsd, rooms },
    flight: flight && {
      airline: flight.airline,
      flightNumber: flight.flightNumber,
      originAirport: flight.originAirport,
      destinationAirport: flight.destinationAirport,
      departTime: flight.departTime,
      durationHours: flight.durationHours,
      stops: flight.stops,
      priceUsdPerTraveler: flight.priceUsdPerTraveler,
      compareUrl: flight.compareUrl,
    },
    costs: { stayUsd, flightsUsd },
    estimatedTotalUsd: stayUsd + flightsUsd,
    dailyBudgetUsd: destination.dailyCostUsd,
    paymentMethod: DEFAULT_PAYMENT_METHOD,
    status: 'proposed',
  };
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
