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

const clay: MantineColorsTuple = [
  '#fdf3ee',
  '#f8e2d6',
  '#f0c2a9',
  '#e8a079',
  '#e08451',
  '#db7238',
  '#c9622a',
  '#ad5121',
  '#9a471c',
  '#863b14',
];

export const DISPLAY_FONT = '"Fraunces Variable", Georgia, "Times New Roman", serif';

export const theme = createTheme({
  primaryColor: 'ink',
  primaryShade: { light: 8, dark: 6 },
  autoContrast: true,
  colors: { ink, clay },
  black: '#1c1917',
  fontFamily: '"DM Sans Variable", system-ui, -apple-system, "Segoe UI", sans-serif',
  headings: { fontFamily: DISPLAY_FONT, fontWeight: '600' },
  defaultRadius: 'md',
  cursorType: 'pointer',
});
