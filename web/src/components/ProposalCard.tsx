import { useState, type ReactNode } from 'react';
import { Alert, Anchor, Badge, Button, Group, Select, Stack, Text } from '@mantine/core';
import { IconBed, IconCreditCard, IconExternalLink, IconPlane } from '@tabler/icons-react';
import {
  SAVED_PAYMENT_METHODS,
  formatCount,
  formatStops,
  formatUsd,
  type ProposalDecision,
  type ProposalStatus,
  type ProposalView,
} from '@app/shared';
import { formatTripDate } from '../formatTrip.util';
import classes from './ProposalCard.module.css';
import { BookingProgress } from './BookingProgress';
import { TripTickets } from './TripTickets';

const STATUS_BADGES: Record<ProposalStatus, { label: string; color: string }> = {
  proposed: { label: 'Ready to book', color: 'clay' },
  confirmed: { label: 'Booked', color: 'teal' },
  cancelled: { label: 'Cancelled', color: 'gray' },
  superseded: { label: 'Replaced', color: 'gray' },
};

const PAYMENT_OPTIONS = SAVED_PAYMENT_METHODS.map(({ id, label, expires }) => ({
  value: id,
  label: `${label} · expires ${expires}`,
}));

interface ProposalCardProps {
  proposal: ProposalView;
  onDecision: (decision: ProposalDecision, paymentMethodId?: string) => Promise<void>;
}

export function ProposalCard({ proposal, onDecision }: ProposalCardProps) {
  const [pendingDecision, setPendingDecision] = useState<ProposalDecision | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [paymentMethodId, setPaymentMethodId] = useState<string>(SAVED_PAYMENT_METHODS[0].id);

  const badge = STATUS_BADGES[proposal.status];
  const isActionable = proposal.status === 'proposed';
  const isInactive = proposal.status === 'cancelled' || proposal.status === 'superseded';

  async function decide(decision: ProposalDecision) {
    setPendingDecision(decision);
    setErrorText(null);
    try {
      await onDecision(decision, decision === 'confirm' ? paymentMethodId : undefined);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Something went wrong. Please try again.');
    } finally {
      setPendingDecision(null);
    }
  }

  return (
    <div className={`${classes.card} ${isInactive ? classes.inactive : ''}`} aria-label="Trip proposal">
      <div className={classes.header}>
        <Group justify="space-between" align="center" wrap="nowrap">
          <span className={classes.eyebrow}>{proposal.flight ? 'Trip package' : 'Stay'}</span>
          <Badge color={badge.color} variant="light" radius="sm">
            {badge.label}
          </Badge>
        </Group>

        {proposal.flight && (
          <Group justify="space-between" align="center" wrap="nowrap" mt="md" mb="md">
            <div>
              <div className={classes.code}>{proposal.flight.originAirport}</div>
              <Text fz="xs" c="dimmed" mt={4}>
                {formatTripDate(proposal.startDate)}
              </Text>
            </div>
            <div className={classes.route}>
              <IconPlane size={18} className={classes.routePlane} />
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className={classes.code}>{proposal.flight.destinationAirport}</div>
              <Text fz="xs" c="dimmed" mt={4}>
                {formatTripDate(proposal.endDate)}
              </Text>
            </div>
          </Group>
        )}

        <div className={classes.destination} style={{ marginTop: proposal.flight ? 0 : 8 }}>
          {proposal.destinationName}, {proposal.country}
        </div>
        <Text fz="sm" c="dimmed" mt={2}>
          {formatTripDate(proposal.startDate)} – {formatTripDate(proposal.endDate)} · {proposal.nights} nights ·{' '}
          {formatCount(proposal.travelers, 'traveler')}
        </Text>
      </div>

      <div className={classes.perforation} aria-hidden />

      <Stack className={classes.section} gap="md">
        <FlightLine proposal={proposal} />
        <LineItem
          icon={<IconBed size={18} stroke={1.6} />}
          title={`${proposal.stay.name} · ★ ${proposal.stay.rating}`}
          detail={`${formatUsd(proposal.stay.nightlyRateUsd)} / night × ${proposal.nights} nights × ${formatCount(proposal.stay.rooms, 'room')}`}
          amount={proposal.costs.stayUsd}
        />
      </Stack>

      <div className={classes.footer}>
        <Group justify="space-between" align="baseline">
          <Text fw={600}>Total</Text>
          <Text fw={700} fz="xl">
            {formatUsd(proposal.estimatedTotalUsd)}
          </Text>
        </Group>
        <Text fz="xs" c="dimmed" mt={2}>
          Plus about {formatUsd(proposal.dailyBudgetUsd)} per person per day for food and activities (not charged).
        </Text>

        {isActionable ? (
          <Select
            mt="md"
            label="Pay with"
            aria-label="Pay with"
            data={PAYMENT_OPTIONS}
            value={paymentMethodId}
            onChange={(value) => value && setPaymentMethodId(value)}
            allowDeselect={false}
            leftSection={<IconCreditCard size={16} stroke={1.6} />}
            comboboxProps={{ withinPortal: true }}
          />
        ) : (
          proposal.status === 'confirmed' && (
            <Group gap={6} mt="md" wrap="nowrap">
              <IconCreditCard size={16} stroke={1.6} />
              <Text fz="sm">Paid with {proposal.paymentMethod}</Text>
            </Group>
          )
        )}

        {proposal.bookingRef && (
          <Text fz="sm" mt="xs" c="teal">
            Booking reference <strong>{proposal.bookingRef}</strong>
          </Text>
        )}

        {proposal.status === 'confirmed' && <TripTickets proposal={proposal} />}

        {errorText && (
          <Alert color="red" variant="light" p="xs" mt="sm">
            {errorText}
          </Alert>
        )}

        {isActionable && pendingDecision === 'confirm' && <BookingProgress />}

        {isActionable && pendingDecision !== 'confirm' && (
          <Stack gap={6} mt="md">
            <Button
              fullWidth
              size="md"
              color="clay"
              disabled={pendingDecision === 'cancel'}
              onClick={() => decide('confirm')}
            >
              Confirm & pay {formatUsd(proposal.estimatedTotalUsd)}
            </Button>
            <Button
              fullWidth
              variant="subtle"
              color="gray"
              loading={pendingDecision === 'cancel'}
              onClick={() => decide('cancel')}
            >
              Cancel
            </Button>
            <Text fz="xs" c="dimmed" ta="center">
              Nothing is booked until you confirm. You can also reply “confirm” or ask for changes.
            </Text>
          </Stack>
        )}
      </div>
    </div>
  );
}

function FlightLine({ proposal }: { proposal: ProposalView }) {
  const { flight } = proposal;
  if (!flight) {
    return (
      <LineItem
        icon={<IconPlane size={18} stroke={1.6} />}
        title="No flight included"
        detail="Ask me to add a flight from your home airport."
      />
    );
  }

  const stops = formatStops(flight.stops);
  return (
    <LineItem
      icon={<IconPlane size={18} stroke={1.6} />}
      title={`${flight.airline} ${flight.flightNumber} · ${flight.originAirport} → ${flight.destinationAirport}`}
      detail={
        <>
          {stops} · {flight.durationHours}h · departs {flight.departTime} · {formatUsd(flight.roundTripPriceUsdPerTraveler)} ×{' '}
          {proposal.travelers} ·{' '}
          <Anchor href={flight.compareUrl} target="_blank" rel="noopener noreferrer" fz="xs" inherit>
            compare on Google Flights <IconExternalLink size={11} style={{ verticalAlign: 'middle' }} />
          </Anchor>
        </>
      }
      amount={proposal.costs.flightsUsd}
    />
  );
}

function LineItem({ icon, title, detail, amount }: { icon: ReactNode; title: string; detail: ReactNode; amount?: number }) {
  return (
    <Group align="flex-start" gap="sm" wrap="nowrap">
      <div className={classes.lineIcon}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text fz="sm" fw={600}>
          {title}
        </Text>
        <Text fz="xs" c="dimmed" mt={2}>
          {detail}
        </Text>
      </div>
      {amount !== undefined && (
        <Text fz="sm" fw={600}>
          {formatUsd(amount)}
        </Text>
      )}
    </Group>
  );
}
