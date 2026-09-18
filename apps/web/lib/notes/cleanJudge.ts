// The judged half of a clean, server side: asks the judge what the pure planner
// (shared/cleanJudge.ts) decided to ask, and hands the answers back to it. The
// derived memories (context_memories) are the statements a conflict is judged
// on, when the space has them. Patient — a clean is not a request a person is
// waiting on — and bounded, so a clean inside the MCP route's budget still ends.

import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { decideMany, judgeConfigured } from '@/lib/judge/client'
import type { Context } from './store'
import { applyJudgedClean, planJudgedClean, type JudgedCleanInput, type JudgedCleanResult } from './shared/cleanJudge'

const CLEAN_JUDGE_DEADLINE_MS = 25_000

/** Notes whose nearest neighbours are read: where new duplicates and conflicts are. */
const RECENT_NOTES = 200
const NEIGHBOURS = 3
/** Cosine similarity a neighbour must reach — the search's own absolute floor. */
const PAIR_MIN_COSINE = 0.55

/**
 * Related pairs from the whole-note vectors: each recently changed note's
 * nearest neighbours, in one indexed query. This is what the embeddings buy the
 * clean — the same neighbourhood by word overlap is an O(n²) pass that takes
 * most of a minute on a thousand notes. Null when the space has no vectors.
 */
async function vectorPairs(context: Context): Promise<{ a: string; b: string }[] | null> {
  try {
    const rows = await prisma.$queryRaw<{ a: string; b: string }[]>`
      SELECT r.path AS a, n.path AS b
      FROM (
        SELECT path, embedding FROM context_note_embeddings
        WHERE space_id = ${context.spaceId} AND owner_key = ${context.ownerKey} AND embedding IS NOT NULL
        ORDER BY mtime DESC LIMIT ${RECENT_NOTES}
      ) r
      CROSS JOIN LATERAL (
        SELECT e.path FROM context_note_embeddings e
        WHERE e.space_id = ${context.spaceId} AND e.owner_key = ${context.ownerKey} AND e.embedding IS NOT NULL
          AND e.path <> r.path AND 1 - (e.embedding <=> r.embedding) >= ${PAIR_MIN_COSINE}
        ORDER BY e.embedding <=> r.embedding LIMIT ${NEIGHBOURS}
      ) n`
    if (rows.length === 0) return null
    const seen = new Set<string>()
    return rows.filter((p) => {
      const key = [p.a, p.b].sort().join('|')
      return seen.has(key) ? false : (seen.add(key), true)
    })
  } catch (err) {
    logger.warn('notes.clean.vector_pairs_failed', { err })
    return null
  }
}

export async function judgeClean(context: Context, input: Omit<JudgedCleanInput, 'claimsByPath' | 'pairs'>): Promise<JudgedCleanResult | null> {
  if (!judgeConfigured()) return null
  const rows = await prisma.contextMemory.findMany({
    where: { spaceId: context.spaceId, ownerKey: context.ownerKey, text: { not: '' } },
    select: { path: true, text: true, mtime: true },
    orderBy: [{ path: 'asc' }, { seq: 'asc' }],
  })
  const mtimeByPath = new Map(input.metas.map((m) => [m.path, m.mtime]))
  const claimsByPath = new Map<string, string[]>()
  for (const r of rows) {
    // A claim from an older save of the note is not what the note says now.
    if (mtimeByPath.get(r.path) !== Number(r.mtime)) continue
    ;(claimsByPath.get(r.path) ?? claimsByPath.set(r.path, []).get(r.path)!).push(r.text)
  }
  const pairs = (await vectorPairs(context)) ?? undefined
  const full = { ...input, claimsByPath, ...(pairs ? { pairs } : {}) }
  const plan = planJudgedClean(full)
  if (plan.requests.length === 0) return null
  const answers = await decideMany(plan.requests, { deadlineMs: CLEAN_JUDGE_DEADLINE_MS, patient: true })
  if (answers.every((a) => a === null)) return null
  return applyJudgedClean(full, plan, answers)
}
