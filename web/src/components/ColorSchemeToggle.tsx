import { ActionIcon, Tooltip, useComputedColorScheme, useMantineColorScheme } from '@mantine/core';
import { IconMoon, IconSun } from '@tabler/icons-react';

export function ColorSchemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const computedScheme = useComputedColorScheme('light');
  const nextScheme = computedScheme === 'dark' ? 'light' : 'dark';

  return (
    <Tooltip label={`Switch to ${nextScheme} mode`}>
      <ActionIcon
        variant="default"
        size={36}
        radius="xl"
        aria-label={`Switch to ${nextScheme} mode`}
        onClick={() => setColorScheme(nextScheme)}
      >
        {computedScheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
      </ActionIcon>
    </Tooltip>
  );
}
