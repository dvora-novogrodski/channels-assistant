import { Center, SimpleGrid, Stack, Text, ThemeIcon, Title, UnstyledButton } from '@mantine/core';
import { IconBeach, IconBuildingCastle, IconMountain, type Icon } from '@tabler/icons-react';
import { BrandMark } from './BrandLogo';
import classes from './WelcomePanel.module.css';

const SUGGESTED_PROMPTS: Array<{ icon: Icon; title: string; prompt: string }> = [
  { icon: IconBeach, title: 'Beach escape', prompt: 'Somewhere warm with beaches in February' },
  { icon: IconBuildingCastle, title: 'City break', prompt: 'A budget city break in Europe for 4 days' },
  { icon: IconMountain, title: 'Adventure', prompt: 'An adventure trip in South America in October' },
];

interface WelcomePanelProps {
  onPick: (prompt: string) => void;
}

export function WelcomePanel({ onPick }: WelcomePanelProps) {
  return (
    <Center mih="55vh">
      <Stack align="center" gap="lg" maw={680} w="100%">
        <BrandMark size={64} />
        <Stack gap={6} align="center">
          <Title order={2} ta="center">
            Where to next?
          </Title>
          <Text c="dimmed" ta="center" maw={480}>
            Tell me when you want to travel and what you enjoy. I'll suggest destinations and prepare a stay for you to
            confirm.
          </Text>
        </Stack>
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm" w="100%">
          {SUGGESTED_PROMPTS.map(({ icon: PromptIcon, title, prompt }) => (
            <UnstyledButton key={prompt} className={classes.prompt} onClick={() => onPick(prompt)}>
              <ThemeIcon variant="light" radius="md" size="lg" mb="xs">
                <PromptIcon size={20} />
              </ThemeIcon>
              <Text fw={600} size="sm">
                {title}
              </Text>
              <Text size="sm" c="dimmed">
                {prompt}
              </Text>
            </UnstyledButton>
          ))}
        </SimpleGrid>
      </Stack>
    </Center>
  );
}
