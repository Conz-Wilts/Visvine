/**
 * Single source of truth for community roles.
 *
 * `moderator` was removed; a community member is either an `admin` or a `member`.
 * This module is intentionally dependency-free so both client components
 * (BulkActionsBar, column builders) and server code (zod schemas, permission
 * checks) can import it without pulling server-only deps into the client bundle.
 */
export const COMMUNITY_ROLES = ["admin", "member"] as const;
export type CommunityRole = (typeof COMMUNITY_ROLES)[number];
