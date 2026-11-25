import { randomInt } from 'node:crypto';
import type { FlightLeg, FlightTickets, ProposalFlight, StayVoucher, TripTickets } from '@app/shared';
import type { Proposal } from './store.js';

const LOCATOR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SEAT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const RETURN_WINDOW_START_HOUR = 12;
const RETURN_WINDOW_HOURS = 8;
const CHECK_IN_TIME = '15:00';
const CHECK_OUT_TIME = '11:00';

export type RandomInt = (min: number, max: number) => number;

export function issueTickets(proposal: Proposal, random: RandomInt = randomInt): TripTickets {
  return {
    flight: proposal.flight && issueFlightTickets(proposal, proposal.flight, random),
    stay: issueStayVoucher(proposal, random),
  };
}

function issueFlightTickets(proposal: Proposal, flight: ProposalFlight, random: RandomInt): FlightTickets {
  const outbound = buildLeg(proposal.startDate, flight.originAirport, flight.destinationAirport, flight.departTime, flight.durationHours);
  const returnDeparture = returnDepartureTime(flight.departTime);
  const inbound = buildLeg(proposal.endDate, flight.destinationAirport, flight.originAirport, returnDeparture, flight.durationHours);

  return {
    recordLocator: randomCode(LOCATOR_ALPHABET, 6, random),
    ticketNumbers: Array.from({ length: proposal.travelers }, () => `901-${randomCode('0123456789', 10, random)}`),
    seats: assignSeats(proposal.travelers, random(8, 30)),
    outbound,
    inbound,
  };
}

function issueStayVoucher(proposal: Proposal, random: RandomInt): StayVoucher {
  return {
    confirmationCode: `H${randomCode('0123456789', 7, random)}`,
    checkIn: proposal.startDate,
    checkOut: proposal.endDate,
    checkInTime: CHECK_IN_TIME,
    checkOutTime: CHECK_OUT_TIME,
  };
}

// The return flight leaves in the afternoon of check-out day, after the hotel's check-out time.
function returnDepartureTime(outboundDeparture: string): string {
  const [hour = 0, minute = 0] = outboundDeparture.split(':').map(Number);
  const returnHour = RETURN_WINDOW_START_HOUR + (hour % RETURN_WINDOW_HOURS);
  return `${String(returnHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function buildLeg(date: string, from: string, to: string, departs: string, durationHours: number): FlightLeg {
  const arrival = addHours(departs, durationHours);
  return { date, from, to, departs, arrives: arrival.time, arrivesNextDay: arrival.nextDay };
}

// Travelers sit together: consecutive letters in one row, continuing in the next row when a row is full.
function assignSeats(travelers: number, firstRow: number): string[] {
  return Array.from({ length: travelers }, (_unused, index) => {
    const row = firstRow + Math.floor(index / SEAT_LETTERS.length);
    return `${row}${SEAT_LETTERS[index % SEAT_LETTERS.length]}`;
  });
}

function addHours(time: string, hours: number): { time: string; nextDay: boolean } {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  const totalHours = hour + hours;
  const wrappedHour = totalHours % 24;
  return {
    time: `${String(wrappedHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    nextDay: totalHours >= 24,
  };
}

function randomCode(alphabet: string, length: number, random: RandomInt): string {
  return Array.from({ length }, () => alphabet[random(0, alphabet.length)]).join('');
}
