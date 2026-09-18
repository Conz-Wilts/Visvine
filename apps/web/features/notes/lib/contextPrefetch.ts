'use client'

// Warm-start cache for the profile Context tab. The panel's first paint waits on
// a JS chunk (Tiptap + the notes stack) and four fetches (config, registry, the
// note itself, the note index) that historically only started when the tab was
// clicked. Profile pages call usePrefetchEntityContext on mount instead, so by
// the time the user clicks over to Context everything is in flight or done.
//
// The cache is the shared request cache (features/shared/lib/requestCache):
// promises keyed by request, one network call per key per fresh window, stale
// values painted instantly while revalidating. The names here are the notes
// surface's own spelling of it.

import { useEffect } from 'react'
import { useSpace } from '@/features/shared/contexts/SpaceContext'
import { entityNotePath } from '@/lib/notes/entities'
import type { NBNode } from '@/lib/types'
import { notesApi } from './notesApi'

import {
  cachedFetch,
  evictRequestCache,
  invalidateRequestCache,
  peekRequestCache,
  primeRequestCache,
  swrFetch,
  watchRequestCache,
} from '@/features/shared/lib/requestCache'

export { cachedFetch, swrFetch }

/** The cached value for a key, if one is already resolved and still fresh
 *  enough to act on — the Context tab's "is the root note there?". */
export const peekContextCache = peekRequestCache
/** Watch cache keys for invalidation. Returns the unsubscribe. */
export const watchContextCache = watchRequestCache
export const invalidateContextCache = invalidateRequestCache
/** Seed the cache with a value we already hold, so the next reader paints from
 *  it synchronously instead of fetching. Used by the note-first create commit:
 *  it just wrote the note, so priming `contextKeys.read` means the entity's
 *  Context tab renders its content on first paint. */
export const primeContextCache = primeRequestCache

// Shared key builders — the panel and the prefetch must agree exactly, or they
// fetch twice and the cache is pure overhead.
export const contextKeys = {
  config: () => 'notes:config',
  access: (c: string, path: string) => `notes:access:${c}:${path}`,
  read: (c: string, path: string) => `notes:read:${c}:${path}`,
  list: (c: string) => `notes:list:${c}`,
  tree: (c: string) => `notes:tree:${c}`,
  settings: (c: string) => `notes:settings:${c}`,
  references: (c: string, path: string) => `notes:refs:${c}:${path}`,
  trash: (c: string) => `notes:trash:${c}`,
  overview: (c: string) => `notes:overview:${c}`,
  publications: (c: string, path: string) => `notes:pubs:${c}:${path}`,
}

export type NoteRead =
  /** `held`: the frontmatter keys the record owns — the raw editor draws them
   *  as not the writer's (lib/notes/shared/heldKeys.ts). */
  | { status: 'ok'; content: string; held: string[] }
  | { status: 'missing' }
  | { status: 'error'; message: string }

// Status-aware single-note read (moved here from EntityContextPanel so the
// prefetch and the panel share one implementation): "no note yet" (404) is an
// editable empty state, any other failure is read-only — never risk upserting
// the entity stub over content that simply failed to load. Errors are returned,
// not thrown, so they'd stick in the cache — cache callers must not memoize the
// error arm (see readNote below).
async function readNoteWithStatus(spaceId: string, path: string): Promise<NoteRead> {
  try {
    const params = new URLSearchParams({ spaceId, path })
    const res = await fetch(`/api/notes/item?${params.toString()}`)
    if (res.status === 404) return { status: 'missing' }
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      return { status: 'error', message: data.error || `Request failed (${res.status})` }
    }
    const { content, held } = (await res.json()) as { content: string; held?: string[] }
    return { status: 'ok', content, held: held ?? [] }
  } catch {
    return { status: 'error', message: 'Failed to load the context note' }
  }
}

/** Cached note read: an 'error' result evicts itself (mirrors the rejection
 *  rule) so a blip during prefetch can't lock the panel into the error state. */
export function readNote(spaceId: string, path: string): Promise<NoteRead> {
  const key = contextKeys.read(spaceId, path)
  return cachedFetch(key, () => readNoteWithStatus(spaceId, path)).then((r) => {
    if (r.status === 'error') evictRequestCache(key)
    return r
  })
}

/** Fire every request the Context tab's first paint depends on. Fire-and-forget:
 *  results land in the cache; nothing here throws.
 *
 *  Exported so the docked tree can fire it the moment a row is clicked: the
 *  requests then overlap the route change instead of starting after the new
 *  panel mounts, and swrFetch serves them synchronously on that first paint —
 *  no skeleton between the tree click and the note. */
export function prefetchNoteContext(spaceId: string, path: string) {
  void cachedFetch(contextKeys.config(), () => notesApi.config()).catch(() => {})
  void cachedFetch(contextKeys.access(spaceId, path), () => notesApi.getAccess(spaceId, path)).catch(() => {})
  void cachedFetch(contextKeys.list(spaceId), () => notesApi.list(spaceId)).catch(() => {})
  void cachedFetch(contextKeys.tree(spaceId), () => notesApi.tree(spaceId)).catch(() => {})
  void readNote(spaceId, path).catch(() => {})
  // Fired alongside the read (not after it — no waterfall): both endpoints
  // return empty results for a missing path, and the panel ignores them when
  // the read lands as anything but 'ok'.
  void cachedFetch(contextKeys.references(spaceId, path), () =>
    notesApi.references(spaceId, path),
  ).catch(() => {})
}

/** Profile pages call this on mount: warms the Context tab's JS chunk and data
 *  as soon as the node is known, so clicking over is (near-)instant. Pass
 *  `enabled` = the same condition that shows the Context tab. */
export function usePrefetchEntityContext(nodeId: string, node: NBNode | null, enabled: boolean) {
  const { currentSpace } = useSpace()
  const spaceId = currentSpace?.id ?? null
  const nodeType = node?.type ?? null
  // Where the note lives — flat, or the folder index once the node converted.
  const notePointer = typeof node?.metadata?.notePath === 'string' ? node.metadata.notePath : null

  useEffect(() => {
    if (!enabled || !nodeType || !spaceId) return
    // Warm the code-split chunk (Tiptap + toolbar icons) alongside the data.
    void import('../components/EntityContextPanel').catch(() => {})
    const path = entityNotePath({
      id: nodeId,
      type: nodeType,
      metadata: notePointer ? { notePath: notePointer } : null,
    })
    if (path) prefetchNoteContext(spaceId, path)
  }, [enabled, nodeId, nodeType, notePointer, spaceId])
}

// The context's home note, spelled here rather than imported: rootIndex.ts
// imports this module, so taking its constant back would close a cycle.
const CONTEXT_ROOT_NOTE = 'index.md'

/** The Directory's own pages call this on mount: the Context tab is one click
 *  away from every one of them, and its first paint needs three code-split
 *  chunks (the docked tree, the panel, Tiptap) plus the tree/list/note reads.
 *  Started when the grid mounts, all of it is warm by the time the tab is
 *  clicked, so the click is a route change over cached data rather than the
 *  whole cold load. Idle-scheduled so it never competes with the grid's own
 *  fetch. */
export function usePrefetchContextRoot(spaceId: string | null, enabled: boolean) {
  useEffect(() => {
    if (!enabled || !spaceId) return
    let cancelled = false
    const warm = () => {
      if (cancelled) return
      void import('../components/ContextSidebar').catch(() => {})
      void import('../components/NoteContextPanel').catch(() => {})
      prefetchNoteContext(spaceId, CONTEXT_ROOT_NOTE)
    }
    const hasIdle = typeof window.requestIdleCallback === 'function'
    const idle = hasIdle
      ? window.requestIdleCallback(warm, { timeout: 1500 })
      : window.setTimeout(warm, 200)
    return () => {
      cancelled = true
      if (hasIdle) window.cancelIdleCallback(idle)
      else window.clearTimeout(idle)
    }
  }, [spaceId, enabled])
}
