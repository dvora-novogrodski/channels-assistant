export class TurnLock {
  private readonly heldConversationIds = new Set<string>();

  isHeld(conversationId: string): boolean {
    return this.heldConversationIds.has(conversationId);
  }

  tryAcquire(conversationId: string): boolean {
    if (this.isHeld(conversationId)) return false;
    this.heldConversationIds.add(conversationId);
    return true;
  }

  release(conversationId: string): void {
    this.heldConversationIds.delete(conversationId);
  }
}
