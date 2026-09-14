import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { parseBody, requireSpaceAdmin } from '@/lib/api/route'
import {
  cleanReach,
  getCleanSchedule,
  listCleanRuns,
  runCleanPass,
  saveCleanSchedule,
} from '@/lib/notes/cleanSchedule'

/**
 * The space's nightly clean, as the Console's Clean section reads and writes it.
 * Admins only, all three verbs: a clean writes notes under an admin's own
 * identity, so scheduling one is admin work by definition.
 *
 *   GET  — the schedule, what it would reach, and the run history
 *   PUT  — save the schedule (the caller becomes the person it runs as)
 *   POST — run one now, as the caller, recorded like a scheduled fire
 *
 * The pass itself is lib/notes/cleanSchedule.ts; nothing here decides what may
 * be cleaned.
 */

const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  hour: z.number().int().min(0).max(23).optional(),
  minute: z.number().int().min(0).max(59).optional(),
  mode: z.enum(['light', 'full']).optional(),
  targetPath: z.string().nullable().optional(),
  applyFixes: z.boolean().optional(),
  fixKinds: z.array(z.string()).max(20).optional(),
  embedEnabled: z.boolean().optional(),
  embedAfterClean: z.boolean().optional(),
})

export async function GET(_req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params
  const session = await requireSpaceAdmin(spaceId)
  if (session instanceof NextResponse) return session

  const schedule = await getCleanSchedule(spaceId)
  // Reach is measured for whoever the schedule runs as; before there is one,
  // for the admin looking at the page — which is who would turn it on.
  const [reach, runs] = await Promise.all([
    schedule.denial ? Promise.resolve(null) : cleanReach(spaceId, schedule.runAs?.userId ?? session.userId),
    listCleanRuns(spaceId),
  ])
  return NextResponse.json({ schedule, reach, runs })
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params
  const session = await requireSpaceAdmin(spaceId)
  if (session instanceof NextResponse) return session
  const body = await parseBody(request, settingsSchema)
  if (body instanceof NextResponse) return body

  try {
    const schedule = await saveCleanSchedule(spaceId, { id: session.userId }, body)
    const reach = schedule.denial ? null : await cleanReach(spaceId, session.userId)
    return NextResponse.json({ schedule, reach })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not save the clean schedule' },
      { status: 400 },
    )
  }
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params
  const session = await requireSpaceAdmin(spaceId)
  if (session instanceof NextResponse) return session

  const outcome = await runCleanPass({ spaceId, trigger: 'manual', startedBy: session.userId })
  const [schedule, runs] = await Promise.all([getCleanSchedule(spaceId), listCleanRuns(spaceId)])
  return NextResponse.json({ outcome: { runId: outcome.runId, status: outcome.status, reason: outcome.reason ?? null }, schedule, runs })
}
