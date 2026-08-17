import { NextRequest, NextResponse } from 'next/server'
import { bad, requireAgentsAccess } from '@/lib/agents/route'
import { activateAgent, deactivateByAdmin, describeAgent } from '@/lib/agents/service'
import { isValidTimeZone, WEEKDAYS, type AgentSchedule } from '@/lib/agents/config'
import { listRuns, type RunListItem } from '@/lib/agents/runs'
import { serializeRun } from '@/lib/agents/service'

/**
 * One agent: brief + activation + state + recent runs. PATCH is the admin
 * activation switch — `{ active: true, schedule, at?, on?, timezone? }` or
 * `{ active: false }`. Activation writes `agents/live/<name>.md` through the
 * ordinary write gate (admin-only path) and re-derives the state row.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ spaceId: string; name: string }> }) {
  const { spaceId, name: raw } = await params
  const name = decodeURIComponent(raw)
  const ctx = await requireAgentsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  const { resolved, principal } = ctx

  const agent = await describeAgent(principal, resolved, name, { includeSpend: resolved.isAdmin })
  if (!agent) return bad('Agent not found', 404)
  const runs: RunListItem[] = await listRuns(spaceId, name, 25)
  return NextResponse.json({
    agent: resolved.isAdmin ? agent : { ...agent, spend: null },
    runs: runs.map(serializeRun),
    isAdmin: resolved.isAdmin,
    canRun: resolved.isAdmin || agent.authorUserId === principal.userId,
  })
}

interface PatchBody {
  active?: unknown
  schedule?: unknown
  at?: unknown
  on?: unknown
  timezone?: unknown
}

function parseScheduleBody(body: PatchBody): { ok: true; schedule: AgentSchedule } | { ok: false; error: string } {
  const kind = typeof body.schedule === 'string' ? body.schedule.toLowerCase() : ''
  if (kind === 'hourly') return { ok: true, schedule: { kind: 'hourly' } }
  if (kind !== 'daily' && kind !== 'weekly') return { ok: false, error: 'schedule must be hourly, daily or weekly' }
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(typeof body.at === 'string' ? body.at.trim() : '')
  if (!m) return { ok: false, error: 'at must be a time like "07:00"' }
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (kind === 'daily') return { ok: true, schedule: { kind: 'daily', hour, minute } }
  const weekday = (WEEKDAYS as readonly string[]).indexOf(typeof body.on === 'string' ? body.on.toLowerCase() : '')
  if (weekday === -1) return { ok: false, error: 'on must be a weekday' }
  return { ok: true, schedule: { kind: 'weekly', hour, minute, weekday } }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ spaceId: string; name: string }> }) {
  const { spaceId, name: raw } = await params
  const name = decodeURIComponent(raw)
  const ctx = await requireAgentsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  const { resolved, principal } = ctx
  if (!resolved.isAdmin) return bad('Only space admins can activate an agent.', 403)

  const body = (await req.json().catch(() => null)) as PatchBody | null
  if (!body || typeof body.active !== 'boolean') return bad('active (boolean) is required')

  if (!body.active) {
    const r = await deactivateByAdmin(principal, resolved, name)
    return r.ok ? NextResponse.json({ ok: true }) : bad(r.error, r.status)
  }

  const schedule = parseScheduleBody(body)
  if (!schedule.ok) return bad(schedule.error)
  let timezone: string | null = null
  if (body.timezone !== undefined && body.timezone !== null && body.timezone !== '') {
    if (typeof body.timezone !== 'string' || !isValidTimeZone(body.timezone)) return bad('timezone must be an IANA zone')
    timezone = body.timezone
  }
  const r = await activateAgent(principal, resolved, name, { schedule: schedule.schedule, timezone })
  if (!r.ok) return bad(r.error, r.status)
  return NextResponse.json({ ok: true, warning: r.warning })
}
