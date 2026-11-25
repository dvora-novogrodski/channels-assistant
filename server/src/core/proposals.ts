import { randomInt } from 'node:crypto';
import { SAVED_PAYMENT_METHODS, type ResolveProposalRequest } from '@app/shared';
import type { Proposal, User } from './store.js';
import { issueTickets } from './tickets.js';

export type ProposalDecision = ResolveProposalRequest['decision'];

export interface DecisionOutcome {
  changed: boolean;
  text: string;
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

// Idempotent: repeating the decision that already happened (a double click, a Slack retry) changes nothing.
export function applyDecision(
  user: User,
  proposal: Proposal,
  decision: ProposalDecision,
  now: Date,
  paymentMethodId?: string,
): DecisionOutcome {
  const targetStatus = decision === 'confirm' ? 'confirmed' : 'cancelled';
  if (proposal.status === targetStatus) return { changed: false, text: describeOutcome(proposal) };
  if (proposal.status !== 'proposed') {
    return { changed: false, text: `That proposal is no longer active (it was ${proposal.status}).` };
  }

  if (decision === 'cancel') {
    proposal.status = 'cancelled';
    return { changed: true, text: describeOutcome(proposal) };
  }

  const paymentMethod = SAVED_PAYMENT_METHODS.find(({ id }) => id === paymentMethodId);
  if (paymentMethod) proposal.paymentMethod = paymentMethod.label;
  proposal.status = 'confirmed';
  proposal.bookingRef = createBookingRef();
  proposal.tickets = issueTickets(proposal);
  user.bookings.push({ ...proposal, bookingRef: proposal.bookingRef, confirmedAt: now.toISOString() });
  return { changed: true, text: describeOutcome(proposal) };
}

function describeOutcome(proposal: Proposal): string {
  if (proposal.status === 'cancelled') {
    return `Cancelled the proposed trip to ${proposal.destinationName}. Nothing was booked.`;
  }
  const travelers = `${proposal.travelers} traveler${proposal.travelers === 1 ? '' : 's'}`;
  const lines = [
    `**✅ Trip booked: ${proposal.destinationName}, ${proposal.country}**`,
    '',
    `- **Dates:** ${formatDate(proposal.startDate)} – ${formatDate(proposal.endDate)} · ${travelers}`,
    `- **Paid:** $${proposal.estimatedTotalUsd.toLocaleString('en-US')} with ${proposal.paymentMethod}`,
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
