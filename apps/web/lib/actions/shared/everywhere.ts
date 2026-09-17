/**
 * Fusing one search run in every space a person can see into one answer.
 *
 * `search_context` with no `space_id` runs the same federated search in each
 * of the caller's spaces, each under their own standing there, and folds the
 * rankings here. Pure: what comes in is one result set per space; what goes
 * out is one list where every hit says which space it was read in.
 *
 * Two things this decides:
 *
 * - A room the caller belongs to is searched directly, so a hit for the same
 *   note reached through its house's `subspaces/<id>/` graft is a duplicate
 *   and is dropped. A room the caller is NOT in has no direct search, so the
 *   house's hop into it is the only read and is kept.
 * - Scores from different spaces are not calibrated against each other, so
 *   the fold sorts by score and stops there — no space is favoured, and the
 *   caller's filters (`type`, `folder`, dates) are the lever, not the order.
 */
import type { FusedResult } from '@/lib/notes/shared/retrieval'
import { parseSubspacePath } from '@/lib/spaces/subspaces'

/** How many spaces one search fans out over. The rest are reported skipped. */
export const MAX_SEARCH_SPACES = 12

export interface SearchedSpace {
  id: string
  name: string
  parent_id: string | null
}

/** A hit as returned across spaces: the space it was read in, beside the rest. */
export type SpaceHit = FusedResult & { space: SearchedSpace }

export interface SpaceSearchRun {
  space: SearchedSpace
  hits: FusedResult[]
}

/** The spaces one call searches, and the count it could not fit. */
export function searchFanout<T extends { id: string }>(spaces: T[], max = MAX_SEARCH_SPACES): { searched: T[]; skipped: number } {
  return { searched: spaces.slice(0, max), skipped: Math.max(0, spaces.length - max) }
}

/**
 * Fold per-space rankings into one. `memberIds` are the spaces searched
 * directly; a house's hop into one of them is the duplicate that is dropped.
 */
export function fuseAcrossSpaces(runs: SpaceSearchRun[], memberIds: Iterable<string>, k?: number): SpaceHit[] {
  const direct = new Set(memberIds)
  const out: SpaceHit[] = []
  for (const run of runs) {
    for (const h of run.hits) {
      const hop = parseSubspacePath(h.path)
      if (hop && direct.has(hop.spaceId)) continue
      out.push({ ...h, space: run.space })
    }
  }
  out.sort((a, b) => b.score - a.score)
  return k ? out.slice(0, k) : out
}
