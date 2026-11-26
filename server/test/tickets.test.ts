import { describe, expect, it } from 'vitest';
import { issueTickets } from '../src/core/tickets.js';
import { sampleProposal } from './fixtures.js';

const LATE_FLIGHT = {
  airline: 'Skylark Air',
  flightNumber: 'SKL 101',
  originAirport: 'TLV',
  destinationAirport: 'LIS',
  departTime: '21:30',
  durationHours: 5,
  stops: 0,
  roundTripPriceUsdPerTraveler: 300,
  compareUrl: 'https://www.google.com/travel/flights?q=x',
};

describe('issueTickets', () => {
  it('issues one e-ticket and seat per traveler, seated together', () => {
    const tickets = issueTickets(sampleProposal({ travelers: 7, flight: LATE_FLIGHT }), () => 0);

    expect(tickets.flight?.ticketNumbers).toHaveLength(7);
    expect(tickets.flight?.ticketNumbers[0]).toMatch(/^901-\d{10}$/);
    expect(tickets.flight?.seats).toEqual(['0A', '0B', '0C', '0D', '0E', '0F', '1A']);
    expect(tickets.flight?.recordLocator).toMatch(/^[A-Z2-9]{6}$/);
  });

  it('builds outbound and return legs with arrival times, including overnight arrivals', () => {
    const tickets = issueTickets(sampleProposal({ flight: LATE_FLIGHT }));

    expect(tickets.flight?.outbound).toEqual({
      date: '2027-05-12',
      from: 'TLV',
      to: 'LIS',
      departs: '21:30',
      arrives: '02:30',
      arrivesNextDay: true,
    });
    expect(tickets.flight?.inbound).toMatchObject({ date: '2027-05-17', from: 'LIS', to: 'TLV', departs: '17:30' });
  });

  it('schedules every return flight after the hotel check-out time', () => {
    for (let hour = 0; hour < 24; hour++) {
      const departTime = `${String(hour).padStart(2, '0')}:15`;
      const tickets = issueTickets(sampleProposal({ flight: { ...LATE_FLIGHT, departTime } }));
      expect((tickets.flight?.inbound.departs ?? '') >= tickets.stay.checkOutTime).toBe(true);
    }
  });

  it('always issues a hotel voucher, and no flight tickets for stay-only trips', () => {
    const tickets = issueTickets(sampleProposal());

    expect(tickets.flight).toBeUndefined();
    expect(tickets.stay).toMatchObject({
      confirmationCode: expect.stringMatching(/^H\d{7}$/),
      checkIn: '2027-05-12',
      checkOut: '2027-05-17',
      checkInTime: '15:00',
      checkOutTime: '11:00',
    });
  });
});
