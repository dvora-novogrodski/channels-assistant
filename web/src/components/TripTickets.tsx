import { Button, Group, Stack, Text } from '@mantine/core';
import { IconCalendarPlus } from '@tabler/icons-react';
import type { FlightLeg, ProposalView } from '@app/shared';
import { downloadTripCalendar } from '../calendar.util';
import { formatTripDate } from '../formatTrip.util';
import classes from './TripTickets.module.css';

interface TripTicketsProps {
  proposal: ProposalView;
}

export function TripTickets({ proposal }: TripTicketsProps) {
  const { tickets, flight } = proposal;
  if (!tickets) return null;

  return (
    <Stack gap="xs" mt="md">
      <Text fw={600} fz="sm">
        Your tickets
      </Text>

      {tickets.flight && flight && (
        <>
          <LegTicket
            label="Outbound"
            leg={tickets.flight.outbound}
            flightNumber={`${flight.airline} ${flight.flightNumber}`}
            seats={tickets.flight.seats}
            recordLocator={tickets.flight.recordLocator}
          />
          <LegTicket
            label="Return"
            leg={tickets.flight.inbound}
            flightNumber={`${flight.airline} ${flight.flightNumber}`}
            seats={tickets.flight.seats}
            recordLocator={tickets.flight.recordLocator}
          />
          <Text fz="xs" c="dimmed">
            E-ticket {tickets.flight.ticketNumbers.length === 1 ? 'number' : 'numbers'}:{' '}
            {tickets.flight.ticketNumbers.join(', ')}
          </Text>
        </>
      )}

      <div className={classes.ticket}>
        <div>
          <div className={classes.label}>Hotel voucher</div>
          <div className={classes.route}>{proposal.stay.name}</div>
          <Text fz="xs" c="dimmed" mt={2}>
            Check-in {formatTripDate(tickets.stay.checkIn)} from {tickets.stay.checkInTime} · check-out{' '}
            {formatTripDate(tickets.stay.checkOut)} by {tickets.stay.checkOutTime}
          </Text>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className={classes.label}>Confirmation</div>
          <div className={classes.code}>{tickets.stay.confirmationCode}</div>
        </div>
      </div>

      <Group>
        <Button
          variant="default"
          size="xs"
          leftSection={<IconCalendarPlus size={15} />}
          onClick={() => downloadTripCalendar(proposal)}
        >
          Add to calendar
        </Button>
      </Group>
    </Stack>
  );
}

interface LegTicketProps {
  label: string;
  leg: FlightLeg;
  flightNumber: string;
  seats: string[];
  recordLocator: string;
}

function LegTicket({ label, leg, flightNumber, seats, recordLocator }: LegTicketProps) {
  return (
    <div className={classes.ticket}>
      <div>
        <div className={classes.label}>
          {label} · {formatTripDate(leg.date)}
        </div>
        <div className={classes.route}>
          {leg.from} → {leg.to}
        </div>
        <Text fz="xs" c="dimmed" mt={2}>
          {flightNumber} · departs {leg.departs} · arrives {leg.arrives}
          {leg.arrivesNextDay ? ' (+1)' : ''} · seats {seats.join(', ')}
        </Text>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div className={classes.label}>Booking code</div>
        <div className={classes.code}>{recordLocator}</div>
      </div>
    </div>
  );
}
