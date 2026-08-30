import { NextRequest, NextResponse } from 'next/server'
import { bad, requireAgentsAccess } from '@/lib/agents/route'
import { activateAgent, canTriggerRun, describeAgent, switchOffAgent } from '@/lib/agents/service'
import { isValidTimeZone, parseDebounce, parseScheduleFields, parseTriggers, type AgentTriggers } from '@/lib/agents/config'
import { listRuns, type RunListItem } from '@/lib/agents/runs'
import { serializeRun } from '@/lib/agents/service'

/**
 * One agent: its brief (which carries the activation) + state + recent runs.
 * PATCH is the switch — `{ active: true, schedule?, at?, on?, every?,
 * triggers?: { context?, webhook? }, debounce?, timezone }` (at least one of
 * schedule / every / triggers; `timezone` is required) or `{ active: false }`.
 * Anyone who can edit the brief may flip it: activating writes the schedule
 * into `agents/<name>/index.md` through the ordinary write gate and re-derives
 * the state row. `canManage` in the GET is that same answer.
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
    canManage: await canTriggerRun(principal, spaceId, name),
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

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ spaceId: string; name: string }> }) {
  const { spaceId, name: raw } = await params
  const name = decodeURIComponent(raw)
  const ctx = await requireAgentsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  const { resolved, principal } = ctx

  const body = (await req.json().catch(() => null)) as PatchBody | null
  if (!body || typeof body.active !== 'boolean') return bad('active (boolean) is required')

  if (!body.active) {
    const r = await switchOffAgent(principal, resolved, name)
    return r.ok ? NextResponse.json({ ok: true }) : bad(r.error, r.status)
  }

  const schedule = parseScheduleFields({ schedule: body.schedule, at: body.at, weekday: body.on, every: body.every })
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
