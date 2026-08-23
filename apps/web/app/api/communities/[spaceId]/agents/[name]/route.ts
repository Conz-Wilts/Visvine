import { NextRequest, NextResponse } from 'next/server'
import { bad, requireAgentsAccess } from '@/lib/agents/route'
import { activateAgent, deactivateByAdmin, describeAgent } from '@/lib/agents/service'
import { isValidTimeZone, parseDebounce, parseEvery, parseTriggers, WEEKDAYS, type AgentSchedule, type AgentTriggers } from '@/lib/agents/config'
import { listRuns, type RunListItem } from '@/lib/agents/runs'
import { serializeRun } from '@/lib/agents/service'

/**
 * One agent: brief + activation + state + recent runs. PATCH is the admin
 * activation switch — `{ active: true, schedule?, at?, on?, every?, triggers?:
 * { context?, webhook? }, debounce?, timezone }` (at least one of schedule /
 * every / triggers; `timezone` is required) or `{ active: false }`. Activation writes `agents/live/<name>.md` through the
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
  every?: unknown
  triggers?: unknown
  debounce?: unknown
  timezone?: unknown
}

/** `schedule` (hourly/daily/weekly) XOR `every` (interval or cron); neither → null (triggers only). */
function parseScheduleBody(body: PatchBody): { ok: true; schedule: AgentSchedule | null } | { ok: false; error: string } {
  const kind = typeof body.schedule === 'string' ? body.schedule.toLowerCase() : ''
  const every = typeof body.every === 'string' ? body.every.trim() : ''
  if (every) {
    if (kind && kind !== 'every' && kind !== 'none') return { ok: false, error: 'schedule and every are exclusive' }
    return parseEvery(every)
  }
  if (!kind || kind === 'none' || kind === 'every') return { ok: true, schedule: null }
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
  let on: AgentTriggers | null = null
  if (body.triggers !== undefined && body.triggers !== null) {
    if (typeof body.triggers !== 'object' || Array.isArray(body.triggers)) return bad('triggers must be an object with context and/or webhook')
    const t = body.triggers as { context?: unknown; webhook?: unknown }
    const empty = (!Array.isArray(t.context) || t.context.length === 0) && !t.webhook
    if (!empty) {
      const parsed = parseTriggers({ ...(Array.isArray(t.context) && t.context.length ? { context: t.context } : {}), ...(t.webhook ? { webhook: t.webhook } : {}) })
      if (!parsed.ok) return bad(parsed.error)
      on = parsed.triggers
    }
  }
  let debounceMs: number | null = null
  if (body.debounce !== undefined && body.debounce !== null && body.debounce !== '') {
    debounceMs = parseDebounce(body.debounce)
    if (debounceMs === null) return bad('debounce must be like "30s" or "2m" (5s … 30m)')
  }
  if (!schedule.schedule && !on) return bad('an active agent needs a schedule, an every interval, or a trigger')
  // Required wherever there is a clock, not defaulted. "Daily at 07:00" is
  // meaningless until somebody says whose 07:00, and the space no longer
  // answers that — the zone is part of the schedule, in the same note. A
  // trigger-only agent has no time to interpret, so it may leave it out.
  const rawZone = typeof body.timezone === 'string' ? body.timezone.trim() : ''
  if (schedule.schedule && !rawZone) return bad('timezone is required — name the IANA zone this agent runs in')
  if (rawZone && !isValidTimeZone(rawZone)) return bad('timezone must be an IANA zone')
  const timezone = rawZone || null
  const r = await activateAgent(principal, resolved, name, { schedule: schedule.schedule, on, debounceMs, timezone })
  if (!r.ok) return bad(r.error, r.status)
  return NextResponse.json({ ok: true, warning: r.warning })
}
