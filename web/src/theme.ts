import { createTheme, type MantineColorsTuple } from '@mantine/core';

const lagoon: MantineColorsTuple = [
  '#e3fbf8',
  '#d2f2ee',
  '#a8e3dc',
  '#7ad4c9',
  '#53c7b8',
  '#3abfae',
  '#29bba9',
  '#16a493',
  '#009282',
  '#007f70',
];

export const theme = createTheme({
  primaryColor: 'lagoon',
  primaryShade: { light: 8, dark: 6 },
  colors: { lagoon },
  fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  headings: {
    fontFamily: '"Plus Jakarta Sans", Inter, system-ui, sans-serif',
    fontWeight: '700',
  },
  defaultRadius: 'md',
  cursorType: 'pointer',
});
