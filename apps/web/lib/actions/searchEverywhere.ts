/**
 * A read with no space: the same read, once per space the caller can act in.
 * `search_context` fuses its rankings through lib/actions/shared/everywhere.ts;
 * the list actions stamp each row with its space through `inSpaces`.
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
import { compareAcrossSearches, type SearchFilters } from '@/lib/notes/shared/retrieval'
import { judgeHits } from '@/lib/notes/rerank'
import type { BrainSearchResult, SearchOptions } from '@/lib/notes/contextService'
import { planSearch } from '@/lib/notes/queryRewrite'
import { fuseAcrossSpaces, searchFanout, type SearchedSpace, type SpaceHit } from '@/lib/actions/shared/everywhere'
import { logger } from '@/lib/logger'
import prisma from '@/lib/prisma'

export interface EverywhereResult {
  hits: SpaceHit[]
  semantic: BrainSearchResult['semantic']
  plan: BrainSearchResult['plan']
  answerable?: boolean
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
        // Judged once, after the fold (below), so no space spends a window of its own.
        const r = await searchFederated(principal, context, query, filters, k, { ...opts, plan: planned, judge: false })
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
  const folded = fuseAcrossSpaces(
    runs.map((r) => ({ space: r.space, hits: r.result?.hits ?? [] })),
    spaces.map((s) => s.id),
  )
  // A space that switched its semantic half off sends no note text to a model
  // at query time; its hits ride along unjudged, after the judged ones.
  const closed = new Set(runs.filter((r) => r.result?.semantic === 'off').map((r) => r.space.id))
  const open = folded.filter((h) => !closed.has(h.space.id))
  const topic = planned.plan.topic || query
  const verdict =
    opts.judge === false || planned.plan.temporalOnly || planned.plan.intent === 'history' ? { hits: open, judged: false } : await judgeHits(topic, open, k)
  const judged = {
    judged: verdict.judged,
    hits: [...verdict.hits, ...folded.filter((h) => closed.has(h.space.id))].sort(compareAcrossSearches).slice(0, k),
  }
  return {
    hits: judged.hits,
    ...(judged.judged ? { answerable: judged.hits.length > 0 } : {}),
    semantic: first?.semantic ?? 'no-key',
    plan: first?.plan ?? { ...planned.plan, rewrite: planned.rewrite },
    searched: spaces,
    skipped,
  }
}

export interface SpaceRun<T> {
  space: SearchedSpace
  result: T
}

/**
 * One read, in the space named or in every space the caller can act in.
 * `list_events`, `list_agents` and `list_connectors` share this with
 * `search_context`: the same resolve per space, the same cap, and a space that
 * fails narrowing the answer rather than failing it. The caller folds the
 * per-space results into its own shape, stamping each row with `space`.
 */
export async function inSpaces<T>(
  ctx: ActionCaller,
  spaceId: string | undefined,
  read: (space: SearchedSpace) => Promise<T>,
): Promise<{ runs: SpaceRun<T>[]; searched: SearchedSpace[]; skipped: number }> {
  const mine = await listMySpaces(ctx)
  const chosen = spaceId ? mine.filter((s) => s.id === spaceId) : mine
  // A named space the caller is not a member of (an admin's reach, say) is
  // still resolved — resolveTarget is the gate, membership only the listing.
  if (spaceId && chosen.length === 0) {
    await resolveTarget(ctx, spaceId)
    const row = await prisma.space.findUnique({ where: { id: spaceId }, select: { name: true, parentId: true } })
    chosen.push({ id: spaceId, name: row?.name ?? spaceId, your_aliases: [], you_manage_it: false, is_personal_space: false, parent_id: row?.parentId ?? null })
  }
  const { searched, skipped } = searchFanout(chosen)
  const spaces: SearchedSpace[] = searched.map((s) => ({ id: s.id, name: s.name, parent_id: s.parent_id }))
  const runs: SpaceRun<T>[] = []
  await Promise.all(
    spaces.map(async (space) => {
      try {
        runs.push({ space, result: await read(space) })
      } catch (err) {
        if (spaceId) throw err
        logger.warn('actions.in_spaces.space_failed', { err, spaceId: space.id })
      }
    }),
  )
  runs.sort((a, b) => spaces.findIndex((s) => s.id === a.space.id) - spaces.findIndex((s) => s.id === b.space.id))
  return { runs, searched: spaces, skipped }
}
