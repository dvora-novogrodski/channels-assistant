export const DEMO_AIRLINES = [
  { name: 'Skylark Air', prefix: 'SKL' },
  { name: 'Meridian Airways', prefix: 'MRD' },
  { name: 'Bluefin Jet', prefix: 'BFJ' },
] as const;

export interface FlightSearch {
  originAirport: string;
  destinationAirport: string;
  departDate: string;
  returnDate: string;
}

export interface FlightOffer {
  id: string;
  airline: string;
  flightNumber: string;
  originAirport: string;
  destinationAirport: string;
  departDate: string;
  returnDate: string;
  departTime: string;
  durationHours: number;
  stops: number;
  priceUsdPerTraveler: number;
}

export interface FlightSearchResult {
  offers: FlightOffer[];
  compareUrl: string;
}

// Demo offers are derived from a hash of the search, so the same search always returns the same flights
// and propose_trip can re-create the offer the user picked without storing search results.
export function searchFlights(search: FlightSearch): FlightSearchResult {
  const offers = DEMO_AIRLINES.map((airline, index) => buildOffer(search, airline, index)).sort(
    (a, b) => a.priceUsdPerTraveler - b.priceUsdPerTraveler,
  );
  return { offers, compareUrl: buildCompareUrl(search) };
}

export function buildCompareUrl({ originAirport, destinationAirport, departDate, returnDate }: FlightSearch): string {
  const query = `Flights from ${originAirport} to ${destinationAirport} on ${departDate} returning ${returnDate}`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(query)}`;
}

function buildOffer(search: FlightSearch, airline: (typeof DEMO_AIRLINES)[number], index: number): FlightOffer {
  const seed = hash(`${search.originAirport}-${search.destinationAirport}-${search.departDate}-${index}`);
  const stops = index === 0 ? 0 : seed % 2;
  const durationHours = 2 + (seed % 12) + stops * 2;
  const priceUsdPerTraveler = Math.round((140 + durationHours * 48 + (seed % 120) - stops * 60) / 5) * 5;
  const departHour = 6 + (seed % 15);
  const departMinute = (seed % 4) * 15;

  return {
    id: `${airline.prefix}-${search.originAirport}-${search.destinationAirport}-${search.departDate}`,
    airline: airline.name,
    flightNumber: `${airline.prefix} ${100 + (seed % 800)}`,
    originAirport: search.originAirport,
    destinationAirport: search.destinationAirport,
    departDate: search.departDate,
    returnDate: search.returnDate,
    departTime: `${String(departHour).padStart(2, '0')}:${String(departMinute).padStart(2, '0')}`,
    durationHours,
    stops,
    priceUsdPerTraveler,
  };
}

function hash(text: string): number {
  let value = 2166136261;
  for (const character of text) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}
