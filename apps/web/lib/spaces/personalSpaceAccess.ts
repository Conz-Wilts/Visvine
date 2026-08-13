// Pure predicate for personal-space privacy, kept dependency-free so it can be
// unit-tested without loading Prisma. A "personal space" is a Space whose
// `personalOwnerId` is set (created per-user on first use, id `me:<userId>`);
// it is private to that one owner. See `spaceReadForbidden` in lib/auth.ts
// for the DB-backed guard that wraps this.

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
