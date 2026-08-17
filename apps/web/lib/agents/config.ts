/**
 * The agent note contract — pure, no I/O (tests import this directly).
 *
 * An agent is TWO notes, because the write gate is path-only and the brief
 * must stay member-writable while activation is admin-only:
 *
 *   agents/<name>.md            the BRIEF — what the agent is
 *   ---
 *   type: agent
 *   title: Weekly digest
 *   description: One line, shown on the roster
 *   model: gemini/gemma-4-31b-it      # <provider>/<model-id>, registry name never a URL
 *   connectors: [hubspot]             # declared reach — names under connectors/
 *   tools: [web]                      # optional extras: web (fetch_url), sandbox (stage 2)
 *   max_turns: 16                     # optional, 1..40
 *   ---
 *   The body is the brief. It is WRAPPED (a fixed preamble + the body), not
 *   passed verbatim as the whole system prompt.
 *
 *   agents/live/<name>.md       the ACTIVATION — whether and when it runs
 *   ---
 *   type: agent-activation
 *   active: true
 *   schedule: daily                   # hourly | daily | weekly
 *   at: "07:00"                       # daily / weekly
 *   on: monday                        # weekly
 *   timezone: Pacific/Auckland        # optional → Space.timezone → UTC
 *   ---
 *
 * Budget is deliberately NOT here: it lives on the AgentState row because
 * money is admin-read while notes are member-read.
 *
 * Both parsers follow the connector precedent — `{ ok, … } | { ok: false,
 * error }` — so a broken note still describes itself on the roster.
 */
import type { NoteFrontmatter } from '@/lib/notes/shared/types'
import { parseModelRef, type ModelRef } from './registry'

export const AGENT_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/
const AGENT_TYPE = 'agent'
const ACTIVATION_TYPE = 'agent-activation'
const DEFAULT_MAX_TURNS = 16
const MAX_MAX_TURNS = 40
const AGENT_TOOL_EXTRAS = ['web', 'sandbox'] as const
type AgentToolExtra = (typeof AGENT_TOOL_EXTRAS)[number]

export function agentBriefPath(name: string): string {
  return `agents/${name}.md`
}
export function agentActivationPath(name: string): string {
  return `agents/live/${name}.md`
}

// ── The brief ────────────────────────────────────────────────────────────────

export interface AgentBrief {
  title: string
  description: string | null
  /** The raw `model:` value, e.g. `gemini/gemma-4-31b-it`. */
  model: string
  modelRef: ModelRef
  connectors: string[]
  tools: AgentToolExtra[]
  maxTurns: number
  /** The system-prompt body (markdown after the frontmatter), trimmed. */
  body: string
}

export type ParseBriefResult = { ok: true; brief: AgentBrief } | { ok: false; error: string }

const CONNECTOR_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i

function stringList(raw: unknown, what: string): { ok: true; list: string[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, list: [] }
  const arr = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : null
  if (!arr) return { ok: false, error: `\`${what}\` must be a list` }
  const list: string[] = []
  for (const item of arr) {
    if (typeof item !== 'string') return { ok: false, error: `\`${what}\` entries must be strings` }
    const v = item.trim()
    if (v) list.push(v)
  }
  return { ok: true, list: [...new Set(list)] }
}

export function parseAgentBrief(fm: NoteFrontmatter, body: string): ParseBriefResult {
  if (typeof fm.type !== 'string' || fm.type.trim().toLowerCase() !== AGENT_TYPE) {
    return { ok: false, error: 'frontmatter must include `type: agent`' }
  }
  const model = parseModelRef(fm.model)
  if (!model.ok) return { ok: false, error: model.error }

  const connectors = stringList(fm.connectors, 'connectors')
  if (!connectors.ok) return connectors
  for (const c of connectors.list) {
    if (!CONNECTOR_NAME_RE.test(c)) return { ok: false, error: `connector name "${c}" is not valid` }
  }

  const tools = stringList(fm.tools, 'tools')
  if (!tools.ok) return tools
  const extras: AgentToolExtra[] = []
  for (const t of tools.list) {
    const key = t.toLowerCase()
    if (!(AGENT_TOOL_EXTRAS as readonly string[]).includes(key)) {
      return { ok: false, error: `unknown tool "${t}" — tools may list ${AGENT_TOOL_EXTRAS.join(', ')}` }
    }
    extras.push(key as AgentToolExtra)
  }

  let maxTurns = DEFAULT_MAX_TURNS
  if (fm.max_turns !== undefined && fm.max_turns !== null) {
    const n = typeof fm.max_turns === 'number' ? fm.max_turns : Number(fm.max_turns)
    if (!Number.isInteger(n) || n < 1 || n > MAX_MAX_TURNS) {
      return { ok: false, error: `\`max_turns\` must be an integer from 1 to ${MAX_MAX_TURNS}` }
    }
    maxTurns = n
  }

  const trimmedBody = body.trim()
  if (!trimmedBody) return { ok: false, error: 'the note body (the brief) is empty' }

  return {
    ok: true,
    brief: {
      title: typeof fm.title === 'string' && fm.title.trim() ? fm.title.trim() : '',
      description: typeof fm.description === 'string' && fm.description.trim() ? fm.description.trim() : null,
      model: String(fm.model).trim(),
      modelRef: model.ref,
      connectors: connectors.list,
      tools: extras,
      maxTurns,
      body: trimmedBody,
    },
  }
}

// ── The activation ───────────────────────────────────────────────────────────

export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

export type AgentSchedule =
  | { kind: 'hourly' }
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekly'; hour: number; minute: number; weekday: number } // 0 = Sunday

export interface AgentActivation {
  active: boolean
  schedule: AgentSchedule | null
  /** IANA zone named by the note, or null to fall back to the Space's. */
  timezone: string | null
}

export type ParseActivationResult = { ok: true; activation: AgentActivation } | { ok: false; error: string }

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

function parseTime(raw: unknown): { hour: number; minute: number } | null {
  if (typeof raw === 'number') {
    // YAML parses `07:00` unquoted as a sexagesimal 420 in some dialects; be kind.
    if (Number.isInteger(raw) && raw >= 0 && raw < 24 * 60) return { hour: Math.floor(raw / 60), minute: raw % 60 }
    return null
  }
  if (typeof raw !== 'string') return null
  const m = TIME_RE.exec(raw.trim())
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : null
}

export function parseAgentActivation(fm: NoteFrontmatter): ParseActivationResult {
  const active = fm.active === true || (typeof fm.active === 'string' && fm.active.trim().toLowerCase() === 'true')

  let timezone: string | null = null
  if (fm.timezone !== undefined && fm.timezone !== null && fm.timezone !== '') {
    if (typeof fm.timezone !== 'string' || !isValidTimeZone(fm.timezone.trim())) {
      return { ok: false, error: `\`timezone\` must be an IANA zone name (got ${JSON.stringify(fm.timezone)})` }
    }
    timezone = fm.timezone.trim()
  }

  let schedule: AgentSchedule | null = null
  if (fm.schedule !== undefined && fm.schedule !== null && fm.schedule !== '') {
    const kind = typeof fm.schedule === 'string' ? fm.schedule.trim().toLowerCase() : ''
    if (kind === 'hourly') {
      schedule = { kind: 'hourly' }
    } else if (kind === 'daily' || kind === 'weekly') {
      const at = parseTime(fm.at)
      if (!at) return { ok: false, error: '`at` must be a time like "07:00" for a daily or weekly schedule' }
      if (kind === 'daily') {
        schedule = { kind: 'daily', ...at }
      } else {
        const on = typeof fm.on === 'string' ? fm.on.trim().toLowerCase() : ''
        const weekday = (WEEKDAYS as readonly string[]).indexOf(on)
        if (weekday === -1) return { ok: false, error: '`on` must name a weekday (monday … sunday) for a weekly schedule' }
        schedule = { kind: 'weekly', ...at, weekday }
      }
    } else {
      return { ok: false, error: '`schedule` must be hourly, daily or weekly' }
    }
  }

  if (active && !schedule) return { ok: false, error: 'an active agent needs a `schedule`' }
  return { ok: true, activation: { active, schedule, timezone } }
}

/** A stable fingerprint of what dispatch derives from — the note is authoritative. */
export function scheduleHash(activation: AgentActivation, effectiveTz: string): string {
  return JSON.stringify([activation.active, activation.schedule, effectiveTz])
}

// ── Schedule math (Intl only, no tz library) ─────────────────────────────────

interface WallClock {
  year: number
  month: number // 1-12
  day: number
  hour: number
  minute: number
  weekday: number // 0 = Sunday
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
const fmtCache = new Map<string, Intl.DateTimeFormat>()

function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
    })
    fmtCache.set(tz, f)
  }
  return f
}

/** The wall clock in `tz` at instant `date`. */
export function wallClockAt(date: Date, tz: string): WallClock {
  const parts = formatter(tz).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const hour = Number(get('hour')) % 24 // some engines report 24 for midnight
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour,
    minute: Number(get('minute')),
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
  }
}

/** Offset of `tz` from UTC at `date`, in minutes (Pacific/Auckland winter = 720). */
function offsetMinutes(date: Date, tz: string): number {
  const w = wallClockAt(date, tz)
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, 0)
  const truncated = Math.floor(date.getTime() / 60_000) * 60_000
  return Math.round((asUtc - truncated) / 60_000)
}

/**
 * The instant at which `tz` shows the given wall clock, with the two DST rules:
 * - a wall time that does not exist (spring forward) → the next instant that
 *   does (07:00 → 08:00);
 * - a wall time that happens twice (fall back) → the FIRST occurrence.
 */
export function zonedWallToInstant(
  tz: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0)
  // Offsets on either side of any transition near the guess.
  const offsets = new Set([
    offsetMinutes(new Date(guess - 24 * 3_600_000), tz),
    offsetMinutes(new Date(guess), tz),
    offsetMinutes(new Date(guess + 24 * 3_600_000), tz),
  ])
  const wanted = Date.UTC(year, month - 1, day, hour, minute, 0)
  const exact: number[] = []
  const later: number[] = []
  for (const off of offsets) {
    const instant = guess - off * 60_000
    const w = wallClockAt(new Date(instant), tz)
    const got = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, 0)
    if (got === wanted) exact.push(instant)
    else if (got > wanted) later.push(instant)
  }
  if (exact.length) return new Date(Math.min(...exact))
  if (later.length) return new Date(Math.min(...later))
  // Should not happen; fall back to the naive guess with the current offset.
  return new Date(guess - offsetMinutes(new Date(guess), tz) * 60_000)
}

/** Add `days` calendar days to a wall-clock date (pure calendar arithmetic). */
function addDays(year: number, month: number, day: number, days: number): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day + days))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

/**
 * The next occurrence of `schedule` strictly after `after`, in `tz`.
 * Never backfills: a missed night is skipped, not replayed.
 */
export function nextOccurrence(schedule: AgentSchedule, after: Date, tz: string): Date {
  if (schedule.kind === 'hourly') {
    const ms = after.getTime()
    return new Date((Math.floor(ms / 3_600_000) + 1) * 3_600_000)
  }
  const now = wallClockAt(after, tz)
  const horizon = schedule.kind === 'daily' ? 3 : 9
  for (let d = 0; d < horizon; d++) {
    const cal = addDays(now.year, now.month, now.day, d)
    if (schedule.kind === 'weekly') {
      const wd = new Date(Date.UTC(cal.year, cal.month - 1, cal.day)).getUTCDay()
      if (wd !== schedule.weekday) continue
    }
    const instant = zonedWallToInstant(tz, cal.year, cal.month, cal.day, schedule.hour, schedule.minute)
    if (instant.getTime() > after.getTime()) return instant
  }
  // Unreachable for valid input; be safe.
  return new Date(after.getTime() + 24 * 3_600_000)
}

/** Human label for the roster ("Daily at 07:00", "Weekly on Monday at 09:30"). */
export function describeSchedule(schedule: AgentSchedule | null, tz: string | null): string {
  if (!schedule) return 'No schedule'
  const hhmm = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  const suffix = tz ? ` (${tz})` : ''
  if (schedule.kind === 'hourly') return 'Every hour'
  if (schedule.kind === 'daily') return `Daily at ${hhmm(schedule.hour, schedule.minute)}${suffix}`
  const day = WEEKDAYS[schedule.weekday]
  return `Weekly on ${day[0].toUpperCase()}${day.slice(1)} at ${hhmm(schedule.hour, schedule.minute)}${suffix}`
}

// ── Note templates ───────────────────────────────────────────────────────────

const yamlString = (s: string) => JSON.stringify(s)

export function newAgentNote(input: {
  name: string
  title?: string
  description?: string
  model?: string
  connectors?: string[]
  tools?: string[]
  body?: string
}): string {
  const title = input.title?.trim() || input.name
  const lines = [
    '---',
    `type: ${AGENT_TYPE}`,
    `title: ${yamlString(title)}`,
    ...(input.description?.trim() ? [`description: ${yamlString(input.description.trim())}`] : []),
    `model: ${input.model?.trim() || 'gemini/gemma-4-31b-it'}`,
    `connectors: [${(input.connectors ?? []).join(', ')}]`,
    ...(input.tools?.length ? [`tools: [${input.tools.join(', ')}]`] : []),
    `max_turns: ${DEFAULT_MAX_TURNS}`,
    '---',
    '',
  ]
  const body =
    input.body?.trim() ||
    `You are ${title}. Describe here what this agent should do on each run: what to read from the context, what to produce, and where to write it.`
  return `${lines.join('\n')}${body}\n`
}

export function newActivationNote(input: {
  active: boolean
  schedule: AgentSchedule | null
  timezone?: string | null
}): string {
  const lines = ['---', `type: ${ACTIVATION_TYPE}`, `active: ${input.active ? 'true' : 'false'}`]
  const s = input.schedule
  if (s) {
    lines.push(`schedule: ${s.kind}`)
    if (s.kind !== 'hourly') {
      lines.push(`at: "${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}"`)
    }
    if (s.kind === 'weekly') lines.push(`on: ${WEEKDAYS[s.weekday]}`)
  }
  if (input.timezone) lines.push(`timezone: ${input.timezone}`)
  lines.push('---', '', 'Activation for this agent — written by a space admin. Only `active`, `schedule`, `at`, `on` and `timezone` are read.', '')
  return lines.join('\n')
}
