// Per-brain vault memo. The Context tab (and the notes workspace, search, MCP)
// fan out into several routes that each need "every live note in the brain" —
// before this cache, one tab open pulled the full corpus from Postgres and
// rebuilt the note index 4-5 times in parallel. getVault serves them all from
// one load.
//
// Best-effort per-instance memory cache, made safe for multi-instance
// serverless by a cheap DB stamp: outside a short coalesce window every
// getVault revalidates `(count, max(updatedAt))` over the brain's live rows
// (one aggregate on the [communityId, ownerKey, deletedAt] index) and rebuilds
// on mismatch. Same-instance writers invalidate explicitly (store.ts mutators),
// so their own reads are never stale; cross-instance staleness is bounded by
// COALESCE_MS.
//
// The visibility-filtered note index is cached per visibility signature
// (metasFor), never shared across signatures — a filtered viewer must not see
// the unfiltered index, or private-folder titles leak through resolved links.

import { listRaw, SHARED_OWNER_KEY, type Brain } from './store'
import prisma from '@/lib/prisma'
import { buildNoteIndex } from './shared/context'
import {
  buildVaultView,
  seesUnfiltered,
  visibilitySignature,
  type VaultView,
} from './shared/vaultView'
import type { BrainPrincipal } from './shared/brainTypes'
import type { NoteMeta, RawNote } from './shared/types'

// Within this window a cached entry is served with zero DB touch, which is what
// collapses one tab-open's parallel route burst into a single corpus load.
const COALESCE_MS = 5_000
// Bound memory: full note bodies are cached per brain, so cap the brains held.
const MAX_BRAINS = 20

interface Stamp {
  count: number
  maxUpdatedMs: number
}

export interface VaultEntry {
  raws: RawNote[]
  /** Full (unfiltered) index — served to super admins and personal brains. */
  metas: NoteMeta[]
  /** Visibility-filtered raws+index per signature (see shared/vaultView.ts). */
  bySig: Map<string, VaultView>
  stamp: Stamp
  checkedAt: number
}

const cache = new Map<string, VaultEntry>()
const loading = new Map<string, Promise<VaultEntry>>()

function keyOf(brain: Brain): string {
  return `${brain.communityId}:${brain.ownerKey}`
}

async function stampOf(brain: Brain): Promise<Stamp> {
  const agg = await prisma.communityNote.aggregate({
    where: { communityId: brain.communityId, ownerKey: brain.ownerKey, deletedAt: null },
    _count: true,
    _max: { updatedAt: true },
  })
  return { count: agg._count, maxUpdatedMs: agg._max.updatedAt?.getTime() ?? 0 }
}

async function build(brain: Brain, stamp: Stamp): Promise<VaultEntry> {
  const raws = await listRaw(brain)
  return { raws, metas: buildNoteIndex(raws), bySig: new Map(), stamp, checkedAt: Date.now() }
}

function touch(key: string, entry: VaultEntry): VaultEntry {
  // Re-insert for LRU recency, then evict the oldest brains past the cap.
  cache.delete(key)
  cache.set(key, entry)
  while (cache.size > MAX_BRAINS) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  return entry
}

/**
 * The brain's live corpus + unfiltered index, loaded from Postgres at most once
 * per change (validated by stamp) and at most once per COALESCE_MS regardless.
 * Concurrent callers share one in-flight load.
 */
export async function getVault(brain: Brain): Promise<VaultEntry> {
  const key = keyOf(brain)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.checkedAt < COALESCE_MS) return touch(key, hit)

  const inFlight = loading.get(key)
  if (inFlight) return inFlight

  const promise = (async () => {
    const stamp = await stampOf(brain)
    const cached = cache.get(key)
    if (
      cached &&
      cached.stamp.count === stamp.count &&
      cached.stamp.maxUpdatedMs === stamp.maxUpdatedMs
    ) {
      cached.checkedAt = Date.now()
      return touch(key, cached)
    }
    return touch(key, await build(brain, stamp))
  })()
  loading.set(key, promise)
  try {
    return await promise
  } finally {
    loading.delete(key)
  }
}

/** Drop a brain's entry — every store.ts mutator calls this after writing. */
export function invalidateVault(brain: Brain): void {
  cache.delete(keyOf(brain))
}

/**
 * The vault as one principal may see it. Personal brains and super admins get
 * the unfiltered corpus; shared-brain viewers get the filterVisible subset with
 * the index rebuilt over only visible raws (no title leak), cached per
 * visibility signature so equally-privileged viewers share one index build.
 * The signature/view logic lives in shared/vaultView.ts (pure, unit-tested).
 */
export function vaultFor(entry: VaultEntry, p: BrainPrincipal, brain: Brain): VaultView {
  if (seesUnfiltered(p, brain.ownerKey === SHARED_OWNER_KEY)) {
    return { raws: entry.raws, metas: entry.metas }
  }
  const sig = visibilitySignature(p)
  const cached = entry.bySig.get(sig)
  if (cached) return cached
  const view = buildVaultView(entry.raws, p)
  entry.bySig.set(sig, view)
  return view
}
