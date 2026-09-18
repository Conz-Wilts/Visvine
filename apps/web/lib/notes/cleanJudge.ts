// The judged half of a clean, server side: asks the judge what the pure planner
// (shared/cleanJudge.ts) decided to ask, and hands the answers back to it. The
// derived memories (context_memories) are the statements a conflict is judged
// on, when the space has them. Patient — a clean is not a request a person is
// waiting on — and bounded, so a clean inside the MCP route's budget still ends.
// A space with its semantic half off is not judged.

import prisma from '@/lib/prisma'
import { decideMany, judgeConfigured } from '@/lib/judge/client'
import type { Context } from './store'
import { applyJudgedClean, planJudgedClean, type JudgedCleanInput, type JudgedCleanResult } from './shared/cleanJudge'

const CLEAN_JUDGE_DEADLINE_MS = 25_000

async function judgingAllowed(spaceId: string): Promise<boolean> {
  if (!judgeConfigured()) return false
  const row = await prisma.contextCleanSchedule.findUnique({ where: { spaceId }, select: { embedEnabled: true } })
  return row?.embedEnabled !== false
}

export async function judgeClean(context: Context, input: Omit<JudgedCleanInput, 'claimsByPath'>): Promise<JudgedCleanResult | null> {
  if (!(await judgingAllowed(context.spaceId))) return null
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
  const full = { ...input, claimsByPath }
  const plan = planJudgedClean(full)
  if (plan.requests.length === 0) return null
  const answers = await decideMany(plan.requests, { deadlineMs: CLEAN_JUDGE_DEADLINE_MS, patient: true })
  if (answers.every((a) => a === null)) return null
  return applyJudgedClean(full, plan, answers)
}
