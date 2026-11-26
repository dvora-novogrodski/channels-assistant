const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MAX_LISTED_MONTHS = 4;

export function formatUsd(amount: number): string {
  return `$${amount.toLocaleString('en-US')}`;
}

export function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function formatStops(stops: number): string {
  return stops === 0 ? 'Direct' : formatCount(stops, 'stop');
}

export function formatMonths(months: number[]): string {
  const names = [...months].sort((a, b) => a - b).map((month) => MONTH_NAMES[month - 1] ?? '');
  if (names.length <= MAX_LISTED_MONTHS) return names.join(', ');
  return `${names.slice(0, MAX_LISTED_MONTHS).join(', ')} +${names.length - MAX_LISTED_MONTHS}`;
}
