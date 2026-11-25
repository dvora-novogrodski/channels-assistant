import { Group, Text, UnstyledButton } from '@mantine/core';
import type { DestinationCardView } from '@app/shared';
import { formatMonths, formatUsd } from '../formatTrip.util';
import classes from './DestinationCards.module.css';

const BUDGET_LABELS: Record<string, string> = { budget: 'Budget', mid: 'Mid-range', luxury: 'Luxury' };
const MAX_TAGS = 3;

interface DestinationCardsProps {
  destinations: DestinationCardView[];
  onPlan: (prompt: string) => void;
}

export function DestinationCards({ destinations, onPlan }: DestinationCardsProps) {
  return (
    <div className={classes.grid}>
      {destinations.map((destination) => (
        <article key={destination.id} className={classes.card}>
          <span className={classes.region}>{destination.region}</span>
          <div>
            <div className={classes.name}>{destination.name}</div>
            <Text fz="sm" c="dimmed">
              {destination.country}
            </Text>
          </div>
          <Text fz="sm">
            <strong>{formatUsd(destination.dailyCostUsd)}</strong>
            <Text span c="dimmed" fz="sm">
              {' '}
              / day · {BUDGET_LABELS[destination.budgetTier] ?? destination.budgetTier}
            </Text>
          </Text>
          <Text fz="xs" c="dimmed">
            Best in {formatMonths(destination.bestMonths)}
          </Text>
          <Group gap={4}>
            {destination.tags.slice(0, MAX_TAGS).map((tag) => (
              <span key={tag} className={classes.tag}>
                {tag}
              </span>
            ))}
          </Group>
          <UnstyledButton className={classes.plan} onClick={() => onPlan(`Plan a trip to ${destination.name}`)}>
            Plan this trip →
          </UnstyledButton>
        </article>
      ))}
    </div>
  );
}
