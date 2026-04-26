export interface UnreadMessageCandidate {
  createdAt: Date;
  senderId: string;
}

export function createDmKey(userIdA: string, userIdB: string): string {
  return [userIdA, userIdB].sort().join(':');
}

export function calculateUnreadCount(
  messages: UnreadMessageCandidate[],
  currentUserId: string,
  lastReadAt: Date | null,
): number {
  return messages.reduce((count, message) => {
    if (message.senderId === currentUserId) {
      return count;
    }

    if (!lastReadAt) {
      return count + 1;
    }

    return message.createdAt > lastReadAt ? count + 1 : count;
  }, 0);
}

export function toIsoStringOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}
