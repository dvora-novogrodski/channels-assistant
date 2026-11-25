import type { Proposal } from '../src/core/store.js';
import { DEFAULT_PAYMENT_METHOD } from '../src/core/tools.js';

export const LISBON_TRIP = { destinationId: 'lisbon-pt', startDate: '2027-05-12', nights: 5, travelers: 2 };

export function sampleProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: 'p-1',
    destinationId: 'lisbon-pt',
    destinationName: 'Lisbon',
    country: 'Portugal',
    startDate: '2027-05-12',
    endDate: '2027-05-17',
    nights: 5,
    travelers: 2,
    stay: { name: 'Alfama Tile House', type: 'guesthouse', rating: 4.5, nightlyRateUsd: 85, rooms: 1 },
    costs: { stayUsd: 425, flightsUsd: 0 },
    estimatedTotalUsd: 425,
    dailyBudgetUsd: 140,
    paymentMethod: DEFAULT_PAYMENT_METHOD,
    status: 'proposed',
    ...overrides,
  };
}
