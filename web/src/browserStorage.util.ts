const USER_ID_KEY = 'travel-assistant:user-id';
const ACTIVE_CONVERSATION_KEY = 'travel-assistant:active-conversation';

function readItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeItem(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    return;
  }
}

export function getOrCreateUserId(): string {
  const existing = readItem(USER_ID_KEY);
  if (existing) return existing;

  const userId = crypto.randomUUID();
  writeItem(USER_ID_KEY, userId);
  return userId;
}

export function readActiveConversationId(): string | null {
  return readItem(ACTIVE_CONVERSATION_KEY);
}

export function saveActiveConversationId(conversationId: string | null): void {
  writeItem(ACTIVE_CONVERSATION_KEY, conversationId);
}
