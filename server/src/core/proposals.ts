import { randomInt } from 'node:crypto';
import type { ResolveProposalRequest } from '@app/shared';
import type { Proposal, User } from './store.js';

export type ProposalDecision = ResolveProposalRequest['decision'];

export interface DecisionOutcome {
  changed: boolean;
  text: string;
}

const DECISION_PATTERNS: Record<ProposalDecision, RegExp> = {
  confirm: /^(confirm|confirmed|yes,? (please )?confirm|book it)[.!]*$/i,
  cancel: /^(cancel|cancel it|no,? cancel)[.!]*$/i,
};

export function parseDecision(text: string): ProposalDecision | undefined {
  const normalized = text.trim();
  if (DECISION_PATTERNS.confirm.test(normalized)) return 'confirm';
  if (DECISION_PATTERNS.cancel.test(normalized)) return 'cancel';
  return undefined;
}

// Idempotent: repeating the decision that already happened (a double click, a Slack retry) changes nothing.
export function applyDecision(user: User, proposal: Proposal, decision: ProposalDecision, now: Date): DecisionOutcome {
  const targetStatus = decision === 'confirm' ? 'confirmed' : 'cancelled';
  if (proposal.status === targetStatus) return { changed: false, text: describeOutcome(proposal) };
  if (proposal.status !== 'proposed') {
    return { changed: false, text: `That proposal is no longer active (it was ${proposal.status}).` };
  }

  if (decision === 'cancel') {
    proposal.status = 'cancelled';
    return { changed: true, text: describeOutcome(proposal) };
  }

  proposal.status = 'confirmed';
  proposal.bookingRef = createBookingRef();
  user.bookings.push({ ...proposal, bookingRef: proposal.bookingRef, confirmedAt: now.toISOString() });
  return { changed: true, text: describeOutcome(proposal) };
}

function describeOutcome(proposal: Proposal): string {
  if (proposal.status === 'cancelled') {
    return `Cancelled the proposed trip to ${proposal.destinationName}. Nothing was booked.`;
  }
  const travelers = `${proposal.travelers} traveler${proposal.travelers === 1 ? '' : 's'}`;
  const total = proposal.estimatedTotalUsd.toLocaleString('en-US');
  const contents = proposal.flight ? `${proposal.flight.airline} flights + ${proposal.stay.name}` : proposal.stay.name;
  return (
    `✅ Trip booked: ${proposal.destinationName}, ${proposal.country} · ${proposal.startDate} → ${proposal.endDate} · ` +
    `${travelers} · ${contents}. Paid $${total} with ${proposal.paymentMethod}. Reference ${proposal.bookingRef}. ` +
    '(Demo booking: no real reservation or payment was made.)'
  );
}

function createBookingRef(): string {
  return `TRV-${randomInt(1000, 10000)}`;
}
