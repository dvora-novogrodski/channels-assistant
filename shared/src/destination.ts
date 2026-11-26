import { z } from 'zod';

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

export const STAY_TYPES = ['hostel', 'guesthouse', 'apartment', 'hotel', 'resort'] as const;

export const StaySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(STAY_TYPES),
  tier: z.enum(BUDGET_TIERS),
  nightlyRateUsd: z.number().positive(),
  rating: z.number().min(0).max(5),
  highlight: z.string(),
});

export const DestinationSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  country: z.string().min(1),
  region: z.enum(REGIONS),
  airportCode: z.string().regex(/^[A-Z]{3}$/),
  stays: z.array(StaySchema).min(1),
  bestMonths: z.array(z.number().int().min(1).max(12)).min(1),
  budgetTier: z.enum(BUDGET_TIERS),
  dailyCostUsd: z.number().positive(),
  idealDays: z
    .object({ min: z.number().int().positive(), max: z.number().int().positive() })
    .refine(({ min, max }) => min <= max, { message: 'idealDays.min must be <= idealDays.max' }),
  tags: z.array(z.enum(TAGS)).min(1),
  highlights: z.array(z.string()).min(1),
  notes: z.string(),
});

export type Destination = z.infer<typeof DestinationSchema>;
export type Stay = z.infer<typeof StaySchema>;
export type StayType = (typeof STAY_TYPES)[number];
export type Region = (typeof REGIONS)[number];
export type BudgetTier = (typeof BUDGET_TIERS)[number];
export type Tag = (typeof TAGS)[number];
