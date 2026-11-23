import { z } from 'zod';
import {
  DestinationSchema,
  type BudgetTier,
  type Destination,
  type Region,
  type Tag,
} from '@app/shared';
import rawDestinations from '../../data/destinations.json' with { type: 'json' };

export const MAX_SEARCH_RESULTS = 5;

export interface DestinationFilters {
  month?: number;
  region?: Region;
  budgetTier?: BudgetTier;
  tags?: Tag[];
  maxDays?: number;
}

export type DestinationSummary = Pick<
  Destination,
  'id' | 'name' | 'country' | 'region' | 'budgetTier' | 'dailyCostUsd' | 'idealDays' | 'tags'
>;

export interface DestinationSearchResult {
  results: DestinationSummary[];
  totalMatches: number;
}

export function parseDestinations(raw: unknown): Destination[] {
  const destinations = z.array(DestinationSchema).parse(raw);
  const seenIds = new Set<string>();
  for (const { id } of destinations) {
    if (seenIds.has(id)) throw new Error(`Duplicate destination id: ${id}`);
    seenIds.add(id);
  }
  return destinations;
}

export const destinations: Destination[] = parseDestinations(rawDestinations);

export function findDestination(id: string, source = destinations): Destination | undefined {
  return source.find((destination) => destination.id === id);
}

export function searchDestinations(
  filters: DestinationFilters,
  source = destinations,
): DestinationSearchResult {
  const matches = source
    .filter((destination) => matchesFilters(destination, filters))
    .sort((a, b) => countMatchingTags(b, filters.tags) - countMatchingTags(a, filters.tags));

  return {
    results: matches.slice(0, MAX_SEARCH_RESULTS).map(toSummary),
    totalMatches: matches.length,
  };
}

function matchesFilters(destination: Destination, filters: DestinationFilters): boolean {
  if (filters.month && !destination.bestMonths.includes(filters.month)) return false;
  if (filters.region && destination.region !== filters.region) return false;
  if (filters.budgetTier && destination.budgetTier !== filters.budgetTier) return false;
  if (filters.maxDays && destination.idealDays.min > filters.maxDays) return false;
  if (filters.tags?.length && countMatchingTags(destination, filters.tags) === 0) return false;
  return true;
}

function countMatchingTags(destination: Destination, tags: Tag[] = []): number {
  return tags.filter((tag) => destination.tags.includes(tag)).length;
}

function toSummary(destination: Destination): DestinationSummary {
  const { id, name, country, region, budgetTier, dailyCostUsd, idealDays, tags } = destination;
  return { id, name, country, region, budgetTier, dailyCostUsd, idealDays, tags };
}
