import { useEffect, useState } from 'react';
import { Group, Loader, Stack, Text, ThemeIcon } from '@mantine/core';
import { IconCheck } from '@tabler/icons-react';

export const BOOKING_STEPS = ['Holding your seats', 'Confirming your hotel', 'Processing payment', 'Issuing your tickets'];
export const BOOKING_STEP_MS = 900;

export function BookingProgress() {
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const timer = setInterval(
      () => setActiveStep((step) => Math.min(step + 1, BOOKING_STEPS.length - 1)),
      BOOKING_STEP_MS,
    );
    return () => clearInterval(timer);
  }, []);

  return (
    <Stack gap={10} mt="md" aria-live="polite">
      {BOOKING_STEPS.map((label, index) => {
        const isDone = index < activeStep;
        const isActive = index === activeStep;
        return (
          <Group key={label} gap="sm" wrap="nowrap">
            {isDone ? (
              <ThemeIcon size={20} radius="xl" color="teal" variant="light">
                <IconCheck size={13} />
              </ThemeIcon>
            ) : (
              <div style={{ width: 20, display: 'grid', placeItems: 'center' }}>
                {isActive ? <Loader size={14} color="clay" /> : <Text c="dimmed">·</Text>}
              </div>
            )}
            <Text fz="sm" c={isDone || isActive ? undefined : 'dimmed'} fw={isActive ? 600 : 400}>
              {label}
              {isActive ? '…' : ''}
            </Text>
          </Group>
        );
      })}
    </Stack>
  );
}
