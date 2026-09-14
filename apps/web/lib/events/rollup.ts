// Events flowing UP from a public sub-space into its parent (docs/sub-spaces.md).
//
// The same rule context follows: a PUBLIC sub-space shows the parent what it
// shows everyone, and nothing more. For events that is its PUBLIC, published
// ones — an event scoped `space` is for the sub-space's own members by its
// own declaration, and surfacing it to the parent would widen it silently.
// Nothing is copied: the parent reads the sub-space's events as of now, and
// each one carries `viaSpace` so the row can be badged and its link opens the
// event in the space that owns it. The presence of `viaSpace` is the
// read-only signal; the manage gates never learn this path.
//
// Pure. The database side — which sub-spaces flow, and their event rows — is
// lib/events/subspaceRollup.ts.

import type { NBEvent } from '@/lib/types/events'

export interface SubspaceRef {
  id: string
  name: string
}

/** Whether one of a sub-space's events is shown to the parent at all. */
export function flowsUpToParent(event: Pick<NBEvent, 'status' | 'visibility'>): boolean {
  return event.status !== 'draft' && event.visibility === 'public'
}

/**
 * The events of `sub` the parent sees, each stamped with where it came from.
 * A sub-space's `space`-scoped and draft events never leave it.
 */
export function rollupEvents<T extends Pick<NBEvent, 'status' | 'visibility'>>(
  sub: SubspaceRef,
  events: readonly T[],
): Array<T & { viaSpace: SubspaceRef }> {
  return events
    .filter(flowsUpToParent)
    .map((e) => ({ ...e, viaSpace: { id: sub.id, name: sub.name } }))
}

/**
 * One list from the parent's own events and its sub-spaces' rolled-up ones,
 * ordered by start. The own list is what the caller already filtered; the
 * rolled-up ones arrive already filtered by `rollupEvents`.
 */
export function mergeByStart<T extends Pick<NBEvent, 'startAt'>>(own: readonly T[], rolled: readonly T[]): T[] {
  return [...own, ...rolled].sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
}
