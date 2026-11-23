import { ActionIcon, Tooltip, useComputedColorScheme, useMantineColorScheme } from '@mantine/core';
import { IconMoon, IconSun } from '@tabler/icons-react';

export function ColorSchemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const computedScheme = useComputedColorScheme('light', { getInitialValueInEffect: true });
  const nextScheme = computedScheme === 'dark' ? 'light' : 'dark';

  return (
    <Tooltip label={`Switch to ${nextScheme} mode`}>
      <ActionIcon
        variant="default"
        size="lg"
        radius="md"
        aria-label={`Switch to ${nextScheme} mode`}
        onClick={() => setColorScheme(nextScheme)}
      >
        {computedScheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
      </ActionIcon>
    </Tooltip>
  );
}
