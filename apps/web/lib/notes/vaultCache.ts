// Per-context vault memo. The Context tab (and the notes workspace, search, MCP)
// fan out into several routes that each need "every live note in the context" —
// before this cache, one tab open pulled the full corpus from Postgres and
// rebuilt the note index 4-5 times in parallel. getVault serves them all from
// one load.
//
// Best-effort per-instance memory cache, made safe for multi-instance
// serverless by a cheap DB stamp: outside a short coalesce window every
// getVault revalidates `(count, max(updatedAt))` over the context's live rows
// (one aggregate on the [spaceId, ownerKey, deletedAt] index) and rebuilds
// on mismatch. Same-instance writers invalidate explicitly (store.ts mutators),
// so their own reads are never stale; cross-instance staleness is bounded by
// COALESCE_MS.
//
// The visibility-filtered note index is cached per visibility signature
// (metasFor), never shared across signatures — a filtered viewer must not see
// the unfiltered index, or private-folder titles leak through resolved links.

import { listRaw, SHARED_OWNER_KEY, type Context } from './store'
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { buildNoteIndex } from './shared/context'
import {
  buildVaultView,
  seesUnfiltered,
  visibilitySignature,
  type VaultView,
} from './shared/vaultView'
import type { ContextPrincipal } from './shared/contextTypes'
import type { NoteMeta, RawNote } from './shared/types'

// Within this window a cached entry is served with zero DB touch, which is what
// collapses one tab-open's parallel route burst into a single corpus load.
const COALESCE_MS = 5_000
// Bound memory: full note bodies are cached per context, so cap the contexts held.
const MAX_CONTEXTS = 20
/**
 * …and cap the BYTES, which is the bound that actually matters.
 *
 * A count cap alone is not a memory bound: 20 contexts is a few megabytes for
 * ordinary spaces and over a gigabyte for twenty large ones, and nothing in the
 * old cap could tell those apart. Retrieval assembles its candidate set in
 * memory (see the note on getVault), so a context's whole live corpus is
 * resident while anyone is searching it — this is the ceiling of the current
 * design and it deserves a number rather than an assumption.
 *
 * 256 MB of note text, evicted least-recently-used. Measured against the
 * present corpus, a note averages ~1 KB, so this holds roughly 250k notes
 * across all resident contexts — far past any space that exists, and small
 * enough that a Cloud Run instance cannot be pushed into an OOM by someone
 * opening enough tabs.
 */
const MAX_CACHE_BYTES = 256 * 1024 * 1024
/**
 * A single context this large is a warning, not an error: it still works, but it
 * is approaching the point where candidate assembly should move into Postgres
 * rather than into Node. Logged once per build so the ceiling is observed before
 * it is hit, instead of being discovered as a latency graph.
 */
const LARGE_CONTEXT_BYTES = 32 * 1024 * 1024
/**
 * Per-entry cap on cached visibility views. Each view shares the underlying note
 * OBJECTS with the unfiltered corpus (filterVisible returns a subset, not
 * copies), so a view costs an array plus its rebuilt index — small, but not
 * nothing, and the number of distinct signatures in a space with per-note grants
 * is bounded only by its membership.
 */
const MAX_VIEWS_PER_ENTRY = 32

interface Stamp {
  count: number
  maxUpdatedMs: number
}

export interface VaultEntry {
  raws: RawNote[]
  /** Full (unfiltered) index — served to super admins and personal contexts. */
  metas: NoteMeta[]
  /** Visibility-filtered raws+index per signature (see shared/vaultView.ts). */
  bySig: Map<string, VaultView>
  stamp: Stamp
  checkedAt: number
  /** Total note-content bytes held by this entry, for the byte-budgeted LRU. */
  bytes: number
}

const cache = new Map<string, VaultEntry>()
const loading = new Map<string, Promise<VaultEntry>>()

function keyOf(context: Context): string {
  return `${context.spaceId}:${context.ownerKey}`
}

async function stampOf(context: Context): Promise<Stamp> {
  const agg = await prisma.contextNote.aggregate({
    where: { spaceId: context.spaceId, ownerKey: context.ownerKey, deletedAt: null },
    _count: true,
    _max: { updatedAt: true },
  })
  return { count: agg._count, maxUpdatedMs: agg._max.updatedAt?.getTime() ?? 0 }
}

async function build(context: Context, stamp: Stamp): Promise<VaultEntry> {
  const raws = await listRaw(context)
  let bytes = 0
  for (const r of raws) bytes += r.content.length
  if (bytes > LARGE_CONTEXT_BYTES) {
    logger.warn('notes.vault.large_context', {
      spaceId: context.spaceId,
      ownerKey: context.ownerKey,
      notes: raws.length,
      bytes,
      // Not an error — it still works. But candidate assembly for search happens
      // over this array in Node, so past roughly this size the right move is to
      // push the first-stage filter into Postgres.
      hint: 'context corpus is large enough that in-memory candidate assembly is becoming the bottleneck',
    })
  }
  return {
    raws,
    metas: buildNoteIndex(raws),
    bySig: new Map(),
    stamp,
    checkedAt: Date.now(),
    bytes,
  }
}

/** Total note bytes currently resident across every cached context. */
function cachedBytes(): number {
  let total = 0
  for (const entry of cache.values()) total += entry.bytes
  return total
}

function touch(key: string, entry: VaultEntry): VaultEntry {
  // Re-insert for LRU recency, then evict the oldest contexts until BOTH bounds
  // hold. The byte budget is the real one — a count cap cannot tell twenty small
  // spaces from twenty large ones, and it was the only bound there used to be.
  cache.delete(key)
  cache.set(key, entry)
  while (cache.size > MAX_CONTEXTS || (cache.size > 1 && cachedBytes() > MAX_CACHE_BYTES)) {
    const oldest = cache.keys().next().value
    // `cache.size > 1` above guarantees the entry just inserted is never the one
    // evicted: a single context larger than the whole budget must still be
    // served, and evicting it here would mean rebuilding it on the next call
    // forever.
    if (oldest === undefined || oldest === key) break
    cache.delete(oldest)
  }
  return entry
}

/**
 * The context's live corpus + unfiltered index, loaded from Postgres at most once
 * per change (validated by stamp) and at most once per COALESCE_MS regardless.
 * Concurrent callers share one in-flight load.
 */
export async function getVault(context: Context): Promise<VaultEntry> {
  const key = keyOf(context)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.checkedAt < COALESCE_MS) return touch(key, hit)

  const inFlight = loading.get(key)
  if (inFlight) return inFlight

  const promise = (async () => {
    const stamp = await stampOf(context)
    const cached = cache.get(key)
    if (
      cached &&
      cached.stamp.count === stamp.count &&
      cached.stamp.maxUpdatedMs === stamp.maxUpdatedMs
    ) {
      cached.checkedAt = Date.now()
      return touch(key, cached)
    }
    return touch(key, await build(context, stamp))
  })()
  loading.set(key, promise)
  try {
    return await promise
  } finally {
    loading.delete(key)
  }
}

/** Drop a context's entry — every store.ts mutator calls this after writing. */
export function invalidateVault(context: Context): void {
  cache.delete(keyOf(context))
}

/**
 * The vault as one principal may see it. Personal contexts and super admins get
 * the unfiltered corpus; shared-context viewers get the filterVisible subset with
 * the index rebuilt over only visible raws (no title leak), cached per
 * visibility signature so equally-privileged viewers share one index build.
 * The signature/view logic lives in shared/vaultView.ts (pure, unit-tested).
 */
export function vaultFor(entry: VaultEntry, p: ContextPrincipal, context: Context): VaultView {
  if (seesUnfiltered(p, context.ownerKey === SHARED_OWNER_KEY)) {
    return { raws: entry.raws, metas: entry.metas }
  }
  const sig = visibilitySignature(p)
  const cached = entry.bySig.get(sig)
  if (cached) {
    // Re-insert for LRU recency, so the eviction below drops the least recently
    // used signature rather than the oldest-created one.
    entry.bySig.delete(sig)
    entry.bySig.set(sig, cached)
    return cached
  }
  const view = buildVaultView(entry.raws, p)
  entry.bySig.set(sig, view)
  while (entry.bySig.size > MAX_VIEWS_PER_ENTRY) {
    const oldest = entry.bySig.keys().next().value
    if (oldest === undefined || oldest === sig) break
    entry.bySig.delete(oldest)
  }
  return view
}
