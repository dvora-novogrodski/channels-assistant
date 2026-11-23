import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { BUDGET_TIERS, REGIONS, TAGS } from '@app/shared';
import { SEARCH_SORT_ORDERS, findDestination, searchDestinations } from './destinations.js';
import type { ToolCall, ToolResult, ToolSpec } from './llm/types.js';
import type { Conversation, Proposal, User } from './store.js';

export const MAX_NIGHTS = 30;
export const MAX_TRAVELERS = 10;

export interface ToolContext {
  user: User;
  conversation: Conversation;
  today: string;
}

export type ToolEffect = { type: 'propose'; proposal: Proposal };

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
  const { $schema: _ignored, ...parameters } = z.toJSONSchema(definition.schema);
  return {
    spec: { name: definition.name, description: definition.description, parameters },
    run: (rawArgs, context) => definition.run(definition.schema.parse(rawArgs), context),
  };
}

const searchDestinationsTool = defineTool({
  name: 'search_destinations',
  description:
    'Search the destination catalog. All filters are optional. Use `month` (1-12) for "when to go" questions and ' +
    '`sortBy: "price"` for cheapest-first results. dailyCostUsd is a rough per-person daily cost (stay, food, local ' +
    'transport; no flights). Returns at most 5 summaries plus the total number of matches.',
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
  description: 'Get full details (highlights, notes, best months, daily cost) for one destination id.',
  schema: z.object({ destinationId: z.string() }),
  run: ({ destinationId }) => ({ output: requireDestination(destinationId) }),
});

const proposeBookingTool = defineTool({
  name: 'propose_booking',
  description:
    'Propose a simulated booking of a STAY (accommodation and daily costs, no flights). This does NOT book ' +
    'anything: the user must confirm it with the button or by replying "confirm". Proposing again replaces the ' +
    'previous pending proposal.',
  schema: z.object({
    destinationId: z.string(),
    startDate: z.iso.date(),
    nights: z.number().int().min(1).max(MAX_NIGHTS),
    travelers: z.number().int().min(1).max(MAX_TRAVELERS),
  }),
  run: ({ destinationId, startDate, nights, travelers }, { today }) => {
    const destination = requireDestination(destinationId);
    if (startDate < today) throw new ToolInputError(`startDate ${startDate} is in the past (today is ${today}).`);

    const proposal: Proposal = {
      id: randomUUID(),
      destinationId,
      destinationName: destination.name,
      country: destination.country,
      startDate,
      endDate: addDays(startDate, nights),
      nights,
      travelers,
      estimatedTotalUsd: destination.dailyCostUsd * nights * travelers,
      status: 'proposed',
    };
    return {
      output: {
        ...proposal,
        note: 'Not booked yet. Covers the stay only, flights not included. Ask the user to confirm with the button or by replying "confirm".',
      },
      effect: { type: 'propose', proposal },
    };
  },
});

const listBookingsTool = defineTool({
  name: 'list_bookings',
  description: "List the user's confirmed (simulated) bookings.",
  schema: z.object({}),
  run: (_args, { user }) => ({ output: { bookings: user.bookings } }),
});

const tools = [searchDestinationsTool, getDestinationTool, proposeBookingTool, listBookingsTool];

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

function requireDestination(destinationId: string) {
  const destination = findDestination(destinationId);
  if (!destination) {
    throw new ToolInputError(`Unknown destinationId "${destinationId}". Use search_destinations to find valid ids.`);
  }
  return destination;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
