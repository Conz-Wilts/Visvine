/**
 * Every GCS object path this app mints, in one place.
 *
 * docs/data-architecture.md §1 gives tier 3 three rules, and the third —
 * "bytes have exactly one owner" — was true of every single-row delete and
 * false of every bulk one. Dropping a space or closing an account removed the
 * rows that owned the objects and left the objects, because the only code that
 * knew how to delete bytes was reached one row at a time. Nothing collected
 * them afterwards, so a deleted space's files stayed in the bucket forever.
 *
 * The fix has two halves and this module is the first: object paths are
 * CONSTRUCTED here and nowhere else, and every one of them begins with the
 * tenant that owns it. That is what makes a prefix delete a safe way to
 * express "these bytes belonged to that space" — the path layout is a checked
 * property of this file rather than a coincidence spread across three modules.
 * (The second half is lib/storage/purge.ts, which uses these prefixes, and
 * scripts/gc-orphan-objects.ts, which reconciles what the eager path missed.)
 *
 * The two historical layouts are kept exactly as they are. Rewriting live
 * object paths would mean copying every byte in production to fix a bookkeeping
 * problem; making them *derivable* costs nothing and buys the same guarantee.
 */

/** A space id is the first path segment after the kind, in every layout below. */
function assertId(kind: string, id: string): string {
  if (!id || !id.trim()) throw new Error(`${kind} id is required to build an object path`);
  // A path separator inside an id would let one tenant's prefix address
  // another's subtree. Ids are internal, but this is the one place where a bad
  // one becomes an authorization boundary rather than a 404.
  if (id.includes('/')) throw new Error(`${kind} id must not contain '/': ${id}`);
  return id;
}

// ─── resources bucket (GCS_RESOURCES_BUCKET) ───

/** Everything the Drive holds for one space. */
export function spaceResourcesPrefix(spaceId: string): string {
  return `resources/${assertId('space', spaceId)}/`;
}

/** The Drive object for one uploaded file. The uuid segment makes it unguessable. */
export function resourceObjectPath(spaceId: string, uuid: string, storedName: string): string {
  return `${spaceResourcesPrefix(spaceId)}${assertId('resource', uuid)}/${storedName}`;
}

/** Every context-source original in one space, across all of its contexts. */
export function spaceContextSourcesPrefix(spaceId: string): string {
  return `context-sources/${assertId('space', spaceId)}/`;
}

/**
 * One context's originals. `ownerKey` is 'shared' or a userId, so this is also
 * the prefix that holds a single person's personal-context files in a space —
 * which is exactly what account deletion needs to remove.
 */
export function contextSourcesPrefix(spaceId: string, ownerKey: string): string {
  return `${spaceContextSourcesPrefix(spaceId)}${assertId('owner', ownerKey)}/`;
}

/** The original bytes behind one ContextSource row. */
export function contextSourceObjectPath(
  spaceId: string,
  ownerKey: string,
  sourceId: string,
  name: string,
): string {
  return `${contextSourcesPrefix(spaceId, ownerKey)}${assertId('source', sourceId)}/${name}`;
}

// ─── media bucket (GCS_MEDIA_BUCKET) ───

/**
 * Image entity kinds, and the prefix each one lives under. Unlike the resources
 * bucket these are keyed by ENTITY id, not by space — a card's images sit under
 * its node id with nothing in the path saying which space that node belongs to.
 * So a space delete cannot express "my images" as one prefix for cards, persons
 * and events; only its own `communities/<id>/` prefix is tenant-derivable.
 *
 * That is why the reconciliation sweep exists rather than being a nicety: for
 * this bucket, walking live entity ids is the only complete answer, and it is
 * also the only thing that catches bytes orphaned by a bug rather than by a
 * known code path.
 */
export const MEDIA_PREFIXES = {
  card: 'cards',
  person: 'persons',
  space: 'communities',
  event: 'events',
} as const;

export type MediaEntityType = keyof typeof MEDIA_PREFIXES;

/** The prefix holding one entity's image variants (original + three avatars). */
export function mediaPrefix(entityType: MediaEntityType, entityId: string): string {
  return `${MEDIA_PREFIXES[entityType]}/${assertId(entityType, entityId)}/`;
}

/**
 * The prefix WITHOUT its trailing slash — the form `uploadProfileImage` and
 * `deleteProfileImage` take, since they append `/<variant>.webp` themselves.
 * Kept separate so no caller has to know which of the two forms it holds.
 */
export function mediaPrefixBare(entityType: MediaEntityType, entityId: string): string {
  return `${MEDIA_PREFIXES[entityType]}/${assertId(entityType, entityId)}`;
}

/** The entity kinds whose images are keyed by a node id. */
export const NODE_MEDIA_TYPES: MediaEntityType[] = ['card', 'person', 'event'];
