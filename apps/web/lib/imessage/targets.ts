/**
 * Where a text lands within a line's family — the I/O half of shared/targets.ts.
 *
 * The house is the line's space. A room is a candidate when the texter is an
 * ACTIVE member of it AND it has a `phone` agent to run: its own brief, or a
 * run-in copy of the house's (which `syncSharedCopies` materialises as an
 * agent_state row stamped `shared_from`, so one query over agent_state
 * covers both). The texter's standing is the whole gate: a room they are not
 * in is not a candidate whatever the text says.
 */
import prisma from '@/lib/prisma'
import { decide } from '@/lib/judge/client'
import { choiceOf } from '@/lib/judge/shared/types'
import { IMESSAGE_TARGET_AT, imessageTargetQuestion } from '@/lib/judge/shared/questions'
import { PHONE_AGENT } from './shared/brief'
import type { TargetCandidate } from './shared/targets'

/** The spaces in `houseId`'s family that `userId` could text about. The house first. */
export async function candidatesFor(houseId: string, userId: string): Promise<TargetCandidate[]> {
  const [house, rooms] = await Promise.all([
    prisma.space.findUnique({ where: { id: houseId }, select: { id: true, name: true, members: { where: { userId, status: 'active' }, select: { id: true } } } }),
    prisma.agentState.findMany({
      where: {
        name: PHONE_AGENT,
        space: { parentId: houseId, members: { some: { userId, status: 'active' } } },
      },
      select: { spaceId: true, space: { select: { name: true } } },
      orderBy: { space: { name: 'asc' } },
    }),
  ])
  if (!house || house.members.length === 0) return []
  const houseHasAgent = (await prisma.agentState.count({ where: { spaceId: houseId, name: PHONE_AGENT } })) > 0
  const out: TargetCandidate[] = []
  if (houseHasAgent) out.push({ spaceId: house.id, name: house.name, house: true })
  for (const r of rooms) out.push({ spaceId: r.spaceId, name: r.space.name, house: false })
  return out
}

/**
 * Ask the judge which candidate a text is about. Null when it cannot say —
 * no key, under the floor, or `unclear` — and the caller asks the person.
 */
export async function judgeTarget(text: string, candidates: readonly TargetCandidate[]): Promise<string | null> {
  if (candidates.length < 2) return candidates[0]?.spaceId ?? null
  const options = Object.fromEntries(candidates.map((c) => [c.spaceId, `The text is about ${c.name}${c.house ? ' (the main space)' : ''}.`]))
  const answers = await decide(text.slice(0, 2_000), { target: imessageTargetQuestion(options) }, { deadlineMs: 2_500 })
  const pick = choiceOf(answers, 'target')
  if (!pick || pick.choice === 'unclear' || pick.confidence < IMESSAGE_TARGET_AT) return null
  return candidates.some((c) => c.spaceId === pick.choice) ? pick.choice : null
}

export async function threadTarget(lineId: string, phone: string): Promise<string | null> {
  const row = await prisma.imessageThread.findUnique({ where: { thread_identity: { lineId, phone } }, select: { spaceId: true } })
  return row?.spaceId ?? null
}

export async function rememberThread(lineId: string, phone: string, spaceId: string): Promise<void> {
  await prisma.imessageThread.upsert({
    where: { thread_identity: { lineId, phone } },
    create: { lineId, phone, spaceId },
    update: { spaceId },
  })
}
