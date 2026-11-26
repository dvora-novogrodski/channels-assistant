export const MAX_SEEN_EVENTS = 1000;

export class SeenEvents {
  private readonly keys = new Set<string>();

  constructor(private readonly limit = MAX_SEEN_EVENTS) {}

  markSeen(eventKey: string): boolean {
    if (this.keys.has(eventKey)) return false;

    this.keys.add(eventKey);
    if (this.keys.size > this.limit) this.forgetOldest();
    return true;
  }

  private forgetOldest(): void {
    const oldest = this.keys.values().next();
    if (!oldest.done) this.keys.delete(oldest.value);
  }
}
