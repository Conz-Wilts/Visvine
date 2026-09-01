// Pure predicate for personal-space privacy, kept dependency-free so it can be
// unit-tested without loading Prisma. A "personal space" is a Space whose
// `personalOwnerId` is set (created per-user on first use, id `me:<userId>`);
// it is private to that one owner. See `spaceReadForbidden` in lib/auth.ts
// for the DB-backed guard that wraps this.

/** Deterministic id → exactly one personal space per user. Pure, so a caller
 * that only needs the id (a lookup, a client component, a test) never pulls in
 * Prisma or the provisioning path. */
export function personalSpaceId(userId: string): string {
  return `me:${userId}`
}

/**
 * True when `spaceId`'s `personalOwnerId` belongs to someone OTHER than
 * `userId` — i.e. it's another user's private personal space and the caller must
 * not read or join it. Normal (shared) spaces (`personalOwnerId` null) and
 * the caller's own personal space both return false.
 */
export function isForeignPersonalSpace(
  personalOwnerId: string | null | undefined,
  userId: string,
): boolean {
  return personalOwnerId != null && personalOwnerId !== userId;
}
