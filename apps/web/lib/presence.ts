// In-memory presence tracker. TTL 60s. Swap to Redis when scaling beyond one node.

declare global {
  var __nbPresence: Map<string, number> | undefined;
}

const lastSeen: Map<string, number> = globalThis.__nbPresence ?? new Map();
if (!globalThis.__nbPresence) globalThis.__nbPresence = lastSeen;

const ONLINE_TTL_MS = 60_000;

export function heartbeat(userId: string) {
  lastSeen.set(userId, Date.now());
}

export function presenceSnapshot(userIds: string[]): Record<string, { online: boolean; lastSeen: string | null }> {
  const result: Record<string, { online: boolean; lastSeen: string | null }> = {};
  for (const id of userIds) {
    const t = lastSeen.get(id);
    result[id] = {
      online: t !== undefined && Date.now() - t < ONLINE_TTL_MS,
      lastSeen: t ? new Date(t).toISOString() : null,
    };
  }
  return result;
}
