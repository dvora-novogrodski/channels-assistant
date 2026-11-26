import { describe, expect, it } from 'vitest';
import { MAX_SEEN_EVENTS, SeenEvents } from '../src/channels/seenEvents.js';

describe('SeenEvents', () => {
  it('accepts an event once and rejects duplicates', () => {
    const seenEvents = new SeenEvents();

    expect(seenEvents.markSeen('D1:111.222')).toBe(true);
    expect(seenEvents.markSeen('D1:111.222')).toBe(false);
  });

  it('forgets the oldest events beyond the cap', () => {
    const seenEvents = new SeenEvents();
    for (let index = 0; index <= MAX_SEEN_EVENTS; index++) {
      seenEvents.markSeen(`event-${index}`);
    }

    expect(seenEvents.markSeen('event-0')).toBe(true);
    expect(seenEvents.markSeen(`event-${MAX_SEEN_EVENTS}`)).toBe(false);
  });
});
