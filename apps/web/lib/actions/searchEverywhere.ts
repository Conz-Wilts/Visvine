/**
 * `search_context` with no space: the same search, once per space the caller
 * can act in, fused by lib/actions/shared/everywhere.ts.
 *
 * Nothing here widens what a person can read. Each space is resolved with
 * `resolveTarget` — the membership and grant lens the web routes use — and
 * searched under that principal, exactly as a call naming it would be. The
 * plan is made once so every space is searched on the same words and the
 * rewrite is paid for once.
 */
import type { ActionCaller } from '@/lib/actions/types'
import { listMySpaces, resolveTarget } from '@/lib/actions/resolve'
import { searchFederated } from '@/lib/notes/federation'
import type { SearchFilters } from '@/lib/notes/shared/retrieval'
import type { BrainSearchResult, SearchOptions } from '@/lib/notes/contextService'
import { planSearch } from '@/lib/notes/queryRewrite'
import { fuseAcrossSpaces, searchFanout, type SearchedSpace, type SpaceHit } from '@/lib/actions/shared/everywhere'
import { logger } from '@/lib/logger'

export interface EverywhereResult {
  hits: SpaceHit[]
  semantic: BrainSearchResult['semantic']
  plan: BrainSearchResult['plan']
  searched: SearchedSpace[]
  skipped: number
}

export async function searchEverywhere(
  ctx: ActionCaller,
  query: string,
  filters: SearchFilters,
  k: number,
  opts: SearchOptions,
): Promise<EverywhereResult> {
  const mine = await listMySpaces(ctx)
  const { searched, skipped } = searchFanout(mine)
  const spaces: SearchedSpace[] = searched.map((s) => ({ id: s.id, name: s.name, parent_id: s.parent_id }))
  const planned = await planSearch(query, Date.now(), { rewrite: opts.rewrite ?? true })

  const runs = await Promise.all(
    spaces.map(async (space) => {
      try {
        const { principal, context } = await resolveTarget(ctx, space.id)
        const r = await searchFederated(principal, context, query, filters, k, { ...opts, plan: planned })
        return { space, result: r }
      } catch (err) {
        // One space failing (membership just revoked, a stage erroring) narrows
        // the answer; it does not fail the search of every other space.
        logger.warn('actions.search_everywhere.space_failed', { err, spaceId: space.id })
        return { space, result: null }
      }
    }),
  )
  const first = runs.find((r) => r.result)?.result
  return {
    hits: fuseAcrossSpaces(
      runs.map((r) => ({ space: r.space, hits: r.result?.hits ?? [] })),
      spaces.map((s) => s.id),
      k,
    ),
    semantic: first?.semantic ?? 'no-key',
    plan: first?.plan ?? { ...planned.plan, rewrite: planned.rewrite },
    searched: spaces,
    skipped,
  }
}
