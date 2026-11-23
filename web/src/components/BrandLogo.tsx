import { Group, Stack, Text } from '@mantine/core';

interface BrandLogoProps {
  size?: number;
  showTagline?: boolean;
}

export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Wayfarer logo">
      <defs>
        <linearGradient id="wayfarer-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#16a493" />
          <stop offset="1" stopColor="#0b6fa4" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#wayfarer-mark)" />
      <circle cx="32" cy="32" r="17" fill="none" stroke="#fff" strokeOpacity={0.45} strokeWidth={2.5} />
      <path d="M32 13 38 32 32 51 26 32Z" fill="#fff" />
      <path d="M32 13 38 32 26 32Z" fill="#ffd27a" />
    </svg>
  );
}

export function BrandLogo({ size = 32, showTagline = false }: BrandLogoProps) {
  return (
    <Group gap="sm" wrap="nowrap">
      <BrandMark size={size} />
      <Stack gap={0}>
        <Text ff="heading" fw={800} fz="lg" lh={1.1}>
          Wayfarer
        </Text>
        {showTagline && (
          <Text size="xs" c="dimmed" lh={1.2}>
            Your AI travel assistant
          </Text>
        )}
      </Stack>
    </Group>
  );
}
