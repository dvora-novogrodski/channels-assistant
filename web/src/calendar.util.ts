import type { BookingView, FlightLeg, ProposalView } from '@app/shared';

interface CalendarEvent {
  uid: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  description: string;
}

export function downloadTripCalendar(proposal: ProposalView | BookingView): void {
  const file = buildTripCalendar(proposal);
  const url = URL.createObjectURL(new Blob([file], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `trip-${proposal.destinationName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.ics`;
  link.click();
  URL.revokeObjectURL(url);
}

export function buildTripCalendar(proposal: ProposalView | BookingView): string {
  const events = [stayEvent(proposal), ...flightEvents(proposal)];
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Travel Assistant//Trips//EN',
    ...events.flatMap(toIcsEvent),
    'END:VCALENDAR',
  ].join('\r\n');
}

function stayEvent(proposal: ProposalView): CalendarEvent {
  const voucher = proposal.tickets?.stay;
  return {
    uid: `${proposal.id}-stay`,
    title: `${proposal.stay.name}, ${proposal.destinationName}`,
    start: proposal.startDate,
    end: proposal.endDate,
    allDay: true,
    description: `Hotel confirmation ${voucher?.confirmationCode ?? '-'} · booking ${proposal.bookingRef ?? '-'}`,
  };
}

function flightEvents(proposal: ProposalView): CalendarEvent[] {
  const tickets = proposal.tickets?.flight;
  const flight = proposal.flight;
  if (!tickets || !flight) return [];

  const legEvent = (leg: FlightLeg, label: string): CalendarEvent => ({
    uid: `${proposal.id}-${label}`,
    title: `✈ ${flight.airline} ${flight.flightNumber} ${leg.from} → ${leg.to}`,
    start: `${leg.date}T${leg.departs}`,
    end: `${leg.arrivesNextDay ? nextDay(leg.date) : leg.date}T${leg.arrives}`,
    allDay: false,
    description: `Booking code ${tickets.recordLocator} · seats ${tickets.seats.join(', ')}`,
  });
  return [legEvent(tickets.outbound, 'outbound'), legEvent(tickets.inbound, 'return')];
}

function toIcsEvent(event: CalendarEvent): string[] {
  const dateLine = (name: string, value: string) =>
    event.allDay ? `${name};VALUE=DATE:${value.replace(/-/g, '')}` : `${name}:${value.replace(/[-:]/g, '')}00`;
  return [
    'BEGIN:VEVENT',
    `UID:${event.uid}@travel-assistant`,
    dateLine('DTSTART', event.start),
    dateLine('DTEND', event.end),
    `SUMMARY:${escapeIcs(event.title)}`,
    `DESCRIPTION:${escapeIcs(event.description)}`,
    'END:VEVENT',
  ];
}

function escapeIcs(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/[,;]/g, (match) => `\\${match}`).replace(/\n/g, '\\n');
}

function nextDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
