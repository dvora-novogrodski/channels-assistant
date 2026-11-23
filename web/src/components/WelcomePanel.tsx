import { Button, Center, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconPlaneTilt } from '@tabler/icons-react';

const SUGGESTED_PROMPTS = [
  'Somewhere warm with beaches in February',
  'A budget city break in Europe for 4 days',
  'An adventure trip in South America in October',
];

interface WelcomePanelProps {
  onPick: (prompt: string) => void;
}

export function WelcomePanel({ onPick }: WelcomePanelProps) {
  return (
    <Center mih="50vh">
      <Stack align="center" gap="md" maw={460}>
        <ThemeIcon size={56} radius="xl" variant="light">
          <IconPlaneTilt size={30} />
        </ThemeIcon>
        <Title order={3} ta="center">
          Where to next?
        </Title>
        <Text c="dimmed" ta="center" size="sm">
          Tell me when you want to travel and what you enjoy. I'll suggest destinations and can prepare a simulated
          booking for you to confirm.
        </Text>
        <Stack gap="xs" w="100%">
          {SUGGESTED_PROMPTS.map((prompt) => (
            <Button key={prompt} variant="default" radius="xl" onClick={() => onPick(prompt)}>
              {prompt}
            </Button>
          ))}
        </Stack>
      </Stack>
    </Center>
  );
}
