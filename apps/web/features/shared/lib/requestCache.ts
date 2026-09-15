'use client'

// One promise cache for every client read that outlives a mount. A key is the
// request; within FRESH_MS every caller shares the same promise (two panels
// mounting in one tick make one network call), and a resolved value is kept for
// KEEP_MS so a re-opened surface paints from the stale value while it
// revalidates. Rejected promises are discarded, retaining any usable stale value,
// and a mutation invalidates its read keys so a save cannot resurrect stale
// content on the next mount.

const FRESH_MS = 60_000 // within this window, don't refetch at all
const KEEP_MS = 10 * 60_000 // stale values still paint instantly, then revalidate

interface Entry {
  promise: Promise<unknown>
  ts: number
  pending?: boolean
  /** Set once the promise resolves — what swrFetch serves synchronously. */
  value?: unknown
  hasValue?: boolean
}

const cache = new Map<string, Entry>()

function startFetch<T>(key: string, fn: () => Promise<T>): Entry {
  const previous = cache.get(key)
  const promise = fn()
  const entry: Entry = { promise, ts: Date.now(), pending: true }
  if (previous?.hasValue && Date.now() - previous.ts < KEEP_MS) {
    entry.value = previous.value
    entry.hasValue = true
    entry.ts = previous.ts
  }
  cache.set(key, entry)
  promise.then(
    (value) => {
      if (cache.get(key) === entry) {
        entry.value = value
        entry.hasValue = true
        entry.pending = false
        entry.ts = Date.now()
      }
    },
    () => {
      if (cache.get(key) !== entry) return
      if (entry.hasValue && Date.now() - entry.ts < KEEP_MS) {
        entry.pending = false
        entry.promise = Promise.resolve(entry.value)
      } else {
        cache.delete(key)
      }
    },
  )
  return entry
}

const inFlight = new Map<string, Promise<unknown>>()

/**
 * Share one request while it is in flight and keep nothing afterwards. For
 * reads that must always be fresh (a realtime-patched list, a membership
 * check) but should still collapse two same-tick callers — a parent and a
 * child, or a doubled dev mount — into one round trip.
 */
export function inflightFetch<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const pending = inFlight.get(key)
  if (pending) return pending as Promise<T>
  const promise = fn().finally(() => {
    if (inFlight.get(key) === promise) inFlight.delete(key)
  })
  inFlight.set(key, promise)
  return promise
}

/** Share pending reads regardless of duration; resolved reads stay fresh for a minute. */
export function cachedFetch<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit && (hit.pending || Date.now() - hit.ts < FRESH_MS)) return hit.promise as Promise<T>
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
    const next = cachedFetch(key, fn)
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

/** The cached value for a key, if one is already resolved and still fresh
 *  enough to act on. Read-only and synchronous: a caller deciding whether it
 *  can skip a round trip asks here rather than awaiting a fetch it may not
 *  need. */
export function peekRequestCache<T>(key: string): T | undefined {
  const hit = cache.get(key)
  if (!hit?.hasValue || Date.now() - hit.ts >= KEEP_MS) return undefined
  return hit.value as T
}

/** Drop a key without notifying watchers — for a read that returned an
 *  error-shaped value the caller does not want memoized. */
export function evictRequestCache(key: string): void {
  cache.delete(key)
  inFlight.delete(key)
}

// Subscribers per key. Invalidation is a mutation signal, not just an eviction:
// a live surface holding the key's data in React state (the docked tree's note
// index) has no other way to learn a save elsewhere changed it, and would keep
// painting the pre-save titles and stars until it remounted.
const watchers = new Map<string, Set<() => void>>()

/** Watch cache keys for invalidation. Returns the unsubscribe. */
export function watchRequestCache(keys: string[], onInvalidate: () => void): () => void {
  for (const key of keys) {
    const set = watchers.get(key) ?? new Set()
    set.add(onInvalidate)
    watchers.set(key, set)
  }
  return () => {
    for (const key of keys) {
      const set = watchers.get(key)
      if (!set) continue
      set.delete(onInvalidate)
      if (set.size === 0) watchers.delete(key)
    }
  }
}

export function invalidateRequestCache(...keys: string[]) {
  const notify = new Set<() => void>()
  for (const key of keys) {
    evictRequestCache(key)
    const set = watchers.get(key)
    if (set) for (const fn of set) notify.add(fn)
  }
  // One pass over the union, so invalidating list + tree together wakes a
  // watcher of both exactly once.
  for (const fn of notify) fn()
}

/** Invalidate every key under a prefix — a space's whole Drive after an
 *  upload, say — without the caller enumerating them. */
export function invalidateRequestCachePrefix(prefix: string) {
  const keys = new Set<string>()
  for (const source of [cache, inFlight, watchers]) {
    for (const key of source.keys()) if (key.startsWith(prefix)) keys.add(key)
  }
  invalidateRequestCache(...keys)
}

/** Seed the cache with a value already in hand, stamped as if just fetched. */
export function primeRequestCache<T>(key: string, value: T): void {
  cache.set(key, { promise: Promise.resolve(value), ts: Date.now(), value, hasValue: true })
}
