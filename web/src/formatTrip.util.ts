const tripDateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const timeFormat = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

export function formatTripDate(isoDate: string): string {
  return tripDateFormat.format(new Date(`${isoDate}T00:00:00Z`));
}

export function formatUsd(amount: number): string {
  return `$${amount.toLocaleString('en-US')}`;
}

export function formatUpdatedAt(isoTimestamp: string, now = new Date()): string {
  const date = new Date(isoTimestamp);
  const isToday = date.toDateString() === now.toDateString();
  return isToday ? timeFormat.format(date) : dayFormat.format(date);
}
