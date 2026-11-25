import { createTheme, type MantineColorsTuple } from '@mantine/core';

const ink: MantineColorsTuple = [
  '#f5f5f4',
  '#e7e5e4',
  '#d6d3d1',
  '#a8a29e',
  '#78716c',
  '#57534e',
  '#44403c',
  '#292524',
  '#1c1917',
  '#0c0a09',
];

export const theme = createTheme({
  primaryColor: 'ink',
  primaryShade: { light: 8, dark: 1 },
  autoContrast: true,
  colors: { ink },
  black: '#1c1917',
  fontFamily: '"DM Sans Variable", system-ui, -apple-system, "Segoe UI", sans-serif',
  headings: { fontFamily: '"DM Sans Variable", system-ui, sans-serif', fontWeight: '650' },
  defaultRadius: 'md',
  cursorType: 'pointer',
});
