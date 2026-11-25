const tripDateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const timeFormat = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

export function formatTripDate(isoDate: string): string {
  return tripDateFormat.format(new Date(`${isoDate}T00:00:00Z`));
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MAX_LISTED_MONTHS = 4;

export function formatMonths(months: number[]): string {
  const names = [...months].sort((a, b) => a - b).map((month) => MONTH_NAMES[month - 1] ?? '');
  if (names.length <= MAX_LISTED_MONTHS) return names.join(', ');
  return `${names.slice(0, MAX_LISTED_MONTHS).join(', ')} +${names.length - MAX_LISTED_MONTHS}`;
}

export function formatUsd(amount: number): string {
  return `$${amount.toLocaleString('en-US')}`;
}

export function formatUpdatedAt(isoTimestamp: string, now = new Date()): string {
  const date = new Date(isoTimestamp);
  const isToday = date.toDateString() === now.toDateString();
  return isToday ? timeFormat.format(date) : dayFormat.format(date);
}
