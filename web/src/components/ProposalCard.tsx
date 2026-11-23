import { useState } from 'react';
import { Alert, Badge, Button, Card, Group, SimpleGrid, Stack, Text, ThemeIcon } from '@mantine/core';
import { IconBed, IconCheck, IconX } from '@tabler/icons-react';
import type { ProposalStatus, ProposalView } from '@app/shared';
import type { ProposalDecision } from '../chatApi';
import { formatTripDate, formatUsd } from '../formatTrip.util';

const STATUS_BADGES: Record<ProposalStatus, { label: string; color: string }> = {
  proposed: { label: 'Proposal · not booked yet', color: 'yellow' },
  confirmed: { label: 'Booked', color: 'green' },
  cancelled: { label: 'Cancelled', color: 'gray' },
  superseded: { label: 'Replaced by a newer proposal', color: 'gray' },
};

interface ProposalCardProps {
  proposal: ProposalView;
  onDecision: (decision: ProposalDecision) => Promise<void>;
}

export function ProposalCard({ proposal, onDecision }: ProposalCardProps) {
  const [pendingDecision, setPendingDecision] = useState<ProposalDecision | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const badge = STATUS_BADGES[proposal.status];
  const isActionable = proposal.status === 'proposed';
  const isInactive = proposal.status === 'cancelled' || proposal.status === 'superseded';

  async function decide(decision: ProposalDecision) {
    setPendingDecision(decision);
    setErrorText(null);
    try {
      await onDecision(decision);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Something went wrong. Please try again.');
    } finally {
      setPendingDecision(null);
    }
  }

  return (
    <Card
      withBorder
      radius="lg"
      padding="md"
      opacity={isInactive ? 0.6 : 1}
      aria-label="Stay proposal"
      style={{ borderLeft: `4px solid var(--mantine-color-${badge.color}-6)` }}
    >
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <ThemeIcon variant="light" radius="md" size="lg">
              <IconBed size={18} />
            </ThemeIcon>
            <div>
              <Text fw={700} ff="heading">
                {proposal.destinationName}, {proposal.country}
              </Text>
              <Text size="xs" c="dimmed">
                Stay · flights not included
              </Text>
            </div>
          </Group>
          <Badge color={badge.color} variant="light" style={{ flexShrink: 0 }}>
            {badge.label}
          </Badge>
        </Group>

        <SimpleGrid cols={2} spacing="xs" verticalSpacing={4}>
          <Detail label="Dates" value={`${formatTripDate(proposal.startDate)} → ${formatTripDate(proposal.endDate)}`} />
          <Detail label="Nights" value={String(proposal.nights)} />
          <Detail label="Travelers" value={String(proposal.travelers)} />
          <Detail label="Estimated total" value={`~${formatUsd(proposal.estimatedTotalUsd)}`} />
        </SimpleGrid>

        {proposal.bookingRef && (
          <Text size="sm" c="green">
            Reference <strong>{proposal.bookingRef}</strong> · simulated stay booking, no payment taken
          </Text>
        )}

        {errorText && (
          <Alert color="red" variant="light" p="xs">
            {errorText}
          </Alert>
        )}

        {isActionable && (
          <Stack gap={6}>
            <Group gap="xs">
              <Button
                leftSection={<IconCheck size={16} />}
                loading={pendingDecision === 'confirm'}
                disabled={pendingDecision === 'cancel'}
                onClick={() => decide('confirm')}
              >
                Confirm stay
              </Button>
              <Button
                variant="default"
                leftSection={<IconX size={16} />}
                loading={pendingDecision === 'cancel'}
                disabled={pendingDecision === 'confirm'}
                onClick={() => decide('cancel')}
              >
                Cancel
              </Button>
            </Group>
            <Text size="xs" c="dimmed">
              You can also reply "confirm" or "cancel".
            </Text>
          </Stack>
        )}
      </Stack>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm" fw={500}>
        {value}
      </Text>
    </div>
  );
}
