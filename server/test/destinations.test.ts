import { describe, expect, it } from 'vitest';
import { REGIONS } from '@app/shared';
import {
  MAX_SEARCH_RESULTS,
  destinations,
  findDestination,
  parseDestinations,
  searchDestinations,
} from '../src/core/destinations.js';

describe('destinations dataset', () => {
  it('loads 25-35 valid destinations covering every region', () => {
    expect(destinations.length).toBeGreaterThanOrEqual(25);
    expect(destinations.length).toBeLessThanOrEqual(35);
    const coveredRegions = new Set(destinations.map((destination) => destination.region));
    expect([...coveredRegions].sort()).toEqual([...REGIONS].sort());
  });

  it('rejects duplicate ids', () => {
    const lisbon = findDestination('lisbon-pt');
    expect(() => parseDestinations([lisbon, lisbon])).toThrow(/Duplicate destination id/);
  });

  it('rejects entries that break the schema', () => {
    const invalid = { ...findDestination('lisbon-pt'), bestMonths: [13] };
    expect(() => parseDestinations([invalid])).toThrow();
  });
});

describe('searchDestinations', () => {
  it('returns only destinations whose best months include the requested month', () => {
    const { results } = searchDestinations({ month: 1 });
    expect(results.length).toBeGreaterThan(0);
    for (const { id } of results) {
      expect(findDestination(id)?.bestMonths).toContain(1);
    }
  });

  it('combines region and budget filters', () => {
    const { results } = searchDestinations({ region: 'Asia', budgetTier: 'budget' });
    expect(results.map(({ id }) => id).sort()).toEqual(['bali-id', 'chiang-mai-th', 'hanoi-ha-long-vn']);
  });

  it('excludes destinations that need more days than available', () => {
    const { results, totalMatches } = searchDestinations({ maxDays: 3 });
    expect(totalMatches).toBeGreaterThan(0);
    for (const { idealDays } of results) {
      expect(idealDays.min).toBeLessThanOrEqual(3);
    }
  });

  it('ranks destinations matching more requested tags first', () => {
    const { results } = searchDestinations({ tags: ['beach', 'romantic', 'food'] });
    expect(results[0]?.id).toBe('amalfi-coast-it');
  });

  it('caps results but reports the total number of matches', () => {
    const { results, totalMatches } = searchDestinations({});
    expect(results).toHaveLength(MAX_SEARCH_RESULTS);
    expect(totalMatches).toBe(destinations.length);
  });

  it('returns no results when nothing matches', () => {
    const { results, totalMatches } = searchDestinations({ region: 'Oceania', tags: ['winter-sports'], month: 4 });
    expect(results).toEqual([]);
    expect(totalMatches).toBe(0);
  });

  it('returns undefined for an unknown destination id', () => {
    expect(findDestination('atlantis-xx')).toBeUndefined();
  });
});
