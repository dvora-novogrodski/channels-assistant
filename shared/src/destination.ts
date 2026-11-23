import { z } from 'zod';

// One zod schema gives us the TS type AND runtime validation of destinations.json.

export const REGIONS = [
  'Europe',
  'Asia',
  'Africa',
  'Middle East',
  'North America',
  'South America',
  'Oceania',
] as const;

export const BUDGET_TIERS = ['budget', 'mid', 'luxury'] as const;

export const TAGS = [
  'beach',
  'city',
  'food',
  'culture',
  'nature',
  'adventure',
  'nightlife',
  'family',
  'romantic',
  'winter-sports',
] as const;

export const DestinationSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/), // e.g. "lisbon-pt"
  name: z.string().min(1),
  country: z.string().min(1),
  region: z.enum(REGIONS),
  // Months (1-12), not "summer": seasons flip between hemispheres.
  bestMonths: z.array(z.number().int().min(1).max(12)).min(1),
  budgetTier: z.enum(BUDGET_TIERS),
  dailyCostUsd: z.number().positive(), // rough, per person per day
  idealDays: z.object({ min: z.number().int().positive(), max: z.number().int().positive() }),
  tags: z.array(z.enum(TAGS)).min(1),
  highlights: z.array(z.string()).min(1),
  notes: z.string(),
});

export type Destination = z.infer<typeof DestinationSchema>;
export type Region = (typeof REGIONS)[number];
export type BudgetTier = (typeof BUDGET_TIERS)[number];
export type Tag = (typeof TAGS)[number];
