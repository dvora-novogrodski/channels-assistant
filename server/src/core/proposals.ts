import { randomInt } from 'node:crypto';
import { SAVED_PAYMENT_METHODS, formatCount, formatUsd, type ProposalDecision } from '@app/shared';
import type { Booking, Proposal } from './store.js';
import { issueTickets } from './tickets.js';

export interface DecisionOutcome {
  changed: boolean;
  text: string;
  proposal: Proposal;
  booking?: Booking;
}

const DECISION_PATTERNS: Record<ProposalDecision, RegExp> = {
  confirm:
    /^(yes,? )?(please )?(confirm(ed)?|book)( it| this| the trip| trip| the booking| booking| and pay)?( please)?[.!]*$/i,
  cancel: /^(no,? )?(please )?cancel( it| this| the trip| trip| the booking| booking)?( please)?[.!]*$/i,
};

export function parseDecision(text: string): ProposalDecision | undefined {
  const normalized = text.trim();
  if (DECISION_PATTERNS.confirm.test(normalized)) return 'confirm';
  if (DECISION_PATTERNS.cancel.test(normalized)) return 'cancel';
  return undefined;
}

export function decide(
  proposal: Proposal,
  decision: ProposalDecision,
  now: Date,
  paymentMethodId?: string,
): DecisionOutcome {
  const targetStatus = decision === 'confirm' ? 'confirmed' : 'cancelled';
  if (proposal.status === targetStatus) return unchanged(proposal, describeOutcome(proposal));
  if (proposal.status !== 'proposed') {
    return unchanged(proposal, `That proposal is no longer active (it was ${proposal.status}).`);
  }
  if (decision === 'cancel') return cancel(proposal);
  return confirm(proposal, now, paymentMethodId);
}

function unchanged(proposal: Proposal, text: string): DecisionOutcome {
  return { changed: false, text, proposal };
}

function cancel(proposal: Proposal): DecisionOutcome {
  const cancelled: Proposal = { ...proposal, status: 'cancelled' };
  return { changed: true, text: describeOutcome(cancelled), proposal: cancelled };
}

function confirm(proposal: Proposal, now: Date, paymentMethodId: string | undefined): DecisionOutcome {
  const paymentMethod = SAVED_PAYMENT_METHODS.find(({ id }) => id === paymentMethodId)?.label ?? proposal.paymentMethod;
  const bookingRef = createBookingRef();
  const pending = { ...proposal, paymentMethod, bookingRef };
  const confirmed: Proposal = { ...pending, status: 'confirmed', tickets: issueTickets(pending) };
  const booking: Booking = { ...confirmed, bookingRef, confirmedAt: now.toISOString() };
  return { changed: true, text: describeOutcome(confirmed), proposal: confirmed, booking };
}

function describeOutcome(proposal: Proposal): string {
  if (proposal.status === 'cancelled') {
    return `Cancelled the proposed trip to ${proposal.destinationName}. Nothing was booked.`;
  }
  const travelers = formatCount(proposal.travelers, 'traveler');
  const lines = [
    `**✅ Trip booked: ${proposal.destinationName}, ${proposal.country}**`,
    '',
    `- **Dates:** ${formatDate(proposal.startDate)} – ${formatDate(proposal.endDate)} · ${travelers}`,
    `- **Paid:** ${formatUsd(proposal.estimatedTotalUsd)} with ${proposal.paymentMethod}`,
    `- **Booking reference:** \`${proposal.bookingRef}\``,
  ];
  if (proposal.flight && proposal.tickets?.flight) {
    lines.push(`- **Flight:** ${proposal.flight.airline} · booking code \`${proposal.tickets.flight.recordLocator}\``);
  }
  if (proposal.tickets) {
    lines.push(`- **Hotel:** ${proposal.stay.name} · confirmation \`${proposal.tickets.stay.confirmationCode}\``);
  }
  lines.push('', 'Your e-tickets and hotel voucher are on the booking card above. Have a great trip!');
  return lines.join('\n');
}

const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

function formatDate(isoDate: string): string {
  return dateFormat.format(new Date(`${isoDate}T00:00:00Z`));
}

function createBookingRef(): string {
  return `TRV-${randomInt(1000, 10000)}`;
}
