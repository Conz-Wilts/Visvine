'use client'

// Warm-start cache for the profile Context tab. The panel's first paint waits on
// a JS chunk (Tiptap + the notes stack) and four fetches (config, registry, the
// note itself, the note index) that historically only started when the tab was
// clicked. Profile pages call usePrefetchEntityContext on mount instead, so by
// the time the user clicks over to Context everything is in flight or done.
//
// The cache stores promises keyed by request. Within FRESH_MS a key is served
// as-is (a prefetch and a panel mount share one network call); resolved values
// are additionally kept for KEEP_MS so swrFetch can paint a re-opened Context
// tab instantly from the stale value while revalidating in the background.
// Rejected promises evict themselves (an error never sticks), and mutations
// invalidate their read keys so a save/delete can't resurrect stale content on
// the next mount.

import { useEffect } from 'react'
import { useCommunity } from '@/lib/contexts/CommunityContext'
import { entityNotePath } from '@/lib/notes/entities'
import type { NBNode } from '@/lib/types'
import { notesApi } from './notesApi'

const FRESH_MS = 60_000 // within this window, don't refetch at all
const KEEP_MS = 10 * 60_000 // stale values still paint instantly, then revalidate

interface Entry {
  promise: Promise<unknown>
  ts: number
  /** Set once the promise resolves — what swrFetch serves synchronously. */
  value?: unknown
  hasValue?: boolean
}

const cache = new Map<string, Entry>()

function startFetch<T>(key: string, fn: () => Promise<T>): Entry {
  const promise = fn()
  const entry: Entry = { promise, ts: Date.now() }
  cache.set(key, entry)
  promise.then(
    (value) => {
      if (cache.get(key) === entry) {
        entry.value = value
        entry.hasValue = true
      }
    },
    () => {
      if (cache.get(key) === entry) cache.delete(key)
    },
  )
  return entry
}

/** Run `fn` once per `key` per fresh window; concurrent/later callers within
 *  the window get the same promise. Rejections evict immediately so a transient
 *  failure during prefetch never poisons the panel's own attempt. */
export function cachedFetch<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.ts < FRESH_MS) return hit.promise as Promise<T>
  return startFetch(key, fn).promise as Promise<T>
}

/**
 * Stale-while-revalidate read. A resolved value younger than KEEP_MS is
 * delivered via `onData` immediately (synchronously — the caller paints with no
 * spinner); if it's older than FRESH_MS a background refetch follows and
 * `onData` fires again with the fresh value. Cold cache degrades to a plain
 * cachedFetch. Returns a promise settling with the freshest value delivered,
 * so await-style callers keep working; rejections only occur on a cold-cache
 * fetch failure (a failed background revalidation keeps the stale value).
 */
export function swrFetch<T>(key: string, fn: () => Promise<T>, onData: (data: T) => void): Promise<T> {
  const hit = cache.get(key)
  const age = hit ? Date.now() - hit.ts : Infinity

  if (hit?.hasValue && age < KEEP_MS) {
    onData(hit.value as T)
    if (age < FRESH_MS) return hit.promise as Promise<T>
    // Stale: revalidate in the background; deliver again when it lands.
    const next = startFetch(key, fn).promise as Promise<T>
    return next.then(
      (value) => {
        onData(value)
        return value
      },
      () => hit.value as T,
    )
  }

  // Cold (or still in flight and fresh): behave like cachedFetch + deliver.
  const promise = cachedFetch(key, fn)
  return promise.then((value) => {
    onData(value)
    return value
  })
}

export function invalidateContextCache(...keys: string[]) {
  for (const key of keys) cache.delete(key)
}

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
}

export type NoteRead =
  | { status: 'ok'; content: string }
  | { status: 'missing' }
  | { status: 'error'; message: string }

// Status-aware single-note read (moved here from EntityContextPanel so the
// prefetch and the panel share one implementation): "no note yet" (404) is an
// editable empty state, any other failure is read-only — never risk upserting
// the entity stub over content that simply failed to load. Errors are returned,
// not thrown, so they'd stick in the cache — cache callers must not memoize the
// error arm (see readNote below).
async function readNoteWithStatus(communityId: string, path: string): Promise<NoteRead> {
  try {
    const params = new URLSearchParams({ communityId, path })
    const res = await fetch(`/api/notes/item?${params.toString()}`)
    if (res.status === 404) return { status: 'missing' }
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      return { status: 'error', message: data.error || `Request failed (${res.status})` }
    }
    const { content } = (await res.json()) as { content: string }
    return { status: 'ok', content }
  } catch {
    return { status: 'error', message: 'Failed to load the context note' }
  }
}

/** Cached note read: an 'error' result evicts itself (mirrors the rejection
 *  rule) so a blip during prefetch can't lock the panel into the error state. */
export function readNote(communityId: string, path: string): Promise<NoteRead> {
  const key = contextKeys.read(communityId, path)
  return cachedFetch(key, () => readNoteWithStatus(communityId, path)).then((r) => {
    if (r.status === 'error') cache.delete(key)
    return r
  })
}

/** Fire every request the Context tab's first paint depends on. Fire-and-forget:
 *  results land in the cache; nothing here throws. */
function prefetchEntityContext(communityId: string, path: string) {
  void cachedFetch(contextKeys.config(), () => notesApi.config()).catch(() => {})
  void cachedFetch(contextKeys.access(communityId, path), () => notesApi.getAccess(communityId, path)).catch(() => {})
  void cachedFetch(contextKeys.list(communityId), () => notesApi.list(communityId)).catch(() => {})
  void cachedFetch(contextKeys.tree(communityId), () => notesApi.tree(communityId)).catch(() => {})
  void readNote(communityId, path).catch(() => {})
  // Fired alongside the read (not after it — no waterfall): both endpoints
  // return empty results for a missing path, and the panel ignores them when
  // the read lands as anything but 'ok'.
  void cachedFetch(contextKeys.references(communityId, path), () =>
    notesApi.references(communityId, path),
  ).catch(() => {})
}

/** Profile pages call this on mount: warms the Context tab's JS chunk and data
 *  as soon as the node is known, so clicking over is (near-)instant. Pass
 *  `enabled` = the same condition that shows the Context tab. */
export function usePrefetchEntityContext(nodeId: string, node: NBNode | null, enabled: boolean) {
  const { currentCommunity } = useCommunity()
  const communityId = currentCommunity?.id ?? null
  const nodeType = node?.type ?? null

  useEffect(() => {
    if (!enabled || !nodeType || !communityId) return
    // Warm the code-split chunk (Tiptap + toolbar icons) alongside the data.
    void import('../components/EntityContextPanel').catch(() => {})
    const path = entityNotePath({ id: nodeId, type: nodeType })
    if (path) prefetchEntityContext(communityId, path)
  }, [enabled, nodeId, nodeType, communityId])
}
