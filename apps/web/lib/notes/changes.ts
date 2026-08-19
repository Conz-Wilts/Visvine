/**
 * The note change bus — "something under this path changed", per space, per
 * process.
 *
 * Fed from the store's write/rename/delete hooks (via lib/tools/hooks.ts,
 * which already sees every one of them) and read by `GET /api/tools/changes`,
 * which turns it into an SSE stream a Tool frame subscribes to. It carries
 * PATHS, never content: a subscriber that cares re-reads through the bridge,
 * under its own grants, so nothing here is a way to see a note.
 *
 * Per-process on purpose, exactly like lib/messages/realtime.ts: the map lives
 * on `globalThis` so it survives Next's dev-mode module reloads, and it does
 * not survive across instances. A horizontally-scaled deployment needs an
 * external pub/sub before a change on one instance reaches a frame served by
 * another — until then the kit's `useLiveQuery` polls as a fallback, and the
 * whole thing is documented as best-effort.
 *
 * `ownerKey` is on every event because the store hooks fire for personal
 * contexts too. A Tool only ever reads the shared context, so its subscriber
 * filters on it; other consumers may want the personal ones.
 */
import { logger } from '@/lib/logger'

type NoteChangeKind = 'write' | 'rename' | 'delete'

export interface NoteChange {
  spaceId: string
  /** `'shared'` for the space context, else the owning user's id. */
  ownerKey: string
  /** The path that changed — for a rename, the NEW path (the old is `from`). */
  path: string
  kind: NoteChangeKind
  /** Rename only: where it came from. */
  from?: string
}

type Listener = (change: NoteChange) => void
type ListenerMap = Map<string, Set<Listener>>

declare global {
  var noteChangeListeners: ListenerMap | undefined
}

const listeners: ListenerMap = globalThis.noteChangeListeners ?? new Map()
if (!globalThis.noteChangeListeners) globalThis.noteChangeListeners = listeners

/** Deliver a change to every subscriber of its space. Never throws. */
export function publishChange(change: NoteChange): void {
  const set = listeners.get(change.spaceId)
  if (!set) return
  for (const fn of Array.from(set)) {
    try {
      fn(change)
    } catch (err) {
      logger.error('notes.changes.listener.failed', { err, spaceId: change.spaceId, path: change.path })
    }
  }
}

/** Subscribe to every change in a space. Returns the unsubscribe. */
export function subscribeChanges(spaceId: string, fn: Listener): () => void {
  let set = listeners.get(spaceId)
  if (!set) {
    set = new Set()
    listeners.set(spaceId, set)
  }
  set.add(fn)
  return () => {
    const current = listeners.get(spaceId)
    if (!current) return
    current.delete(fn)
    if (current.size === 0) listeners.delete(spaceId)
  }
}

/** How many subscribers a space has — for tests and the odd health check. */
export function changeSubscriberCount(spaceId: string): number {
  return listeners.get(spaceId)?.size ?? 0
}
