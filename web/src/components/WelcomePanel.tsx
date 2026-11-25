import { Group, SimpleGrid, Stack, Text, Title, UnstyledButton } from '@mantine/core';
import { IconBed, IconCreditCard, IconPlane, IconSearch } from '@tabler/icons-react';
import classes from './WelcomePanel.module.css';

const SUGGESTED_PROMPTS = [
  { title: 'Beach escape', prompt: 'Somewhere warm with beaches in February' },
  { title: 'City break', prompt: 'A budget city break in Europe for 4 days' },
  { title: 'Big adventure', prompt: 'An adventure trip in South America in October' },
];

const CAPABILITIES = [
  { icon: IconSearch, label: '32 destinations' },
  { icon: IconPlane, label: 'Demo flights + real price links' },
  { icon: IconBed, label: 'Hand-picked stays' },
  { icon: IconCreditCard, label: 'Book with a demo card' },
];

interface WelcomePanelProps {
  onPick: (prompt: string) => void;
}

export function WelcomePanel({ onPick }: WelcomePanelProps) {
  return (
    <Stack gap="xl" py="8vh" maw={640} mx="auto">
      <Stack gap={8}>
        <Title order={1} fz={34} lh={1.15}>
          Where would you like to go?
        </Title>
        <Text c="dimmed" fz="md" maw={520}>
          Tell me when you can travel and what you enjoy. I'll suggest places, find flights and stays, and put
          together a trip you can book in one click.
        </Text>
      </Stack>

      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
        {SUGGESTED_PROMPTS.map(({ title, prompt }) => (
          <UnstyledButton key={prompt} className={classes.prompt} onClick={() => onPick(prompt)}>
            <Text fw={600} fz="sm">
              {title}
            </Text>
            <Text fz="sm" c="dimmed" mt={4}>
              {prompt}
            </Text>
          </UnstyledButton>
        ))}
      </SimpleGrid>

      <Group gap="lg">
        {CAPABILITIES.map(({ icon: Icon, label }) => (
          <Group key={label} gap={6} wrap="nowrap">
            <Icon size={15} stroke={1.6} color="var(--mantine-color-dimmed)" />
            <Text fz="xs" c="dimmed">
              {label}
            </Text>
          </Group>
        ))}
      </Group>
    </Stack>
  );
}
