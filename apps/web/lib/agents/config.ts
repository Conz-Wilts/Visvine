/**
 * The agent note contract — pure, no I/O (tests import this directly).
 *
 * An agent is TWO notes, because the write gate is path-only and the brief
 * must stay member-writable while activation is admin-only:
 *
 *   agents/<name>.md            the BRIEF — what the agent is; it may sit in a
 *                               folder of agents (agents/ops/<name>.md) — the
 *                               name is always the leaf, unique in the space
 *   ---
 *   type: agent
 *   title: Weekly digest
 *   description: One line, shown on the roster
 *   model: gemini/gemma-4-31b-it      # <provider>/<model-id>, registry name never a URL
 *   connectors: [hubspot]             # declared reach — names under connectors/
 *   tools: [web]                      # optional extras: web (fetch_url), sandbox (run_code),
 *                                     #   messages (notify to a channel), directory (create_node/link_nodes)
 *   agents: [digest]                  # optional — agents this one may chain into with run_agent
 *   dry_run: true                     # optional — writes are captured in the transcript, not applied
 *   max_turns: 16                     # optional, 1..40
 *   ---
 *   The body is the brief. It is WRAPPED (a fixed preamble + the body), not
 *   passed verbatim as the whole system prompt.
 *
 *   agents/live/<name>.md       the ACTIVATION — whether and when it runs
 *   ---
 *   type: agent-activation
 *   active: true
 *   schedule: daily                   # hourly | daily | weekly   (XOR with `every`)
 *   at: "07:00"                       # daily / weekly
 *   on: monday                        # weekly (a bare string is the weekday)
 *   every: 15m                        # Nm | Nh (5m..24h) or a 5-field cron
 *   on:                               # a MAP declares event triggers
 *     context: ["people/**"]          #   note created/saved/renamed-to under a glob
 *     webhook: hubspot                #   connector whose inbound hook feeds this agent
 *     weekday: monday                 #   only with schedule: weekly (the bare string, moved here)
 *   debounce: 2m                      # coalesce window: Ns | Nm, default 60s, max 30m
 *   timezone: Pacific/Auckland        # optional → Space.timezone → UTC
 *   ---
 *   An active agent needs at least one of `schedule`, `every` or `on`.
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
const AGENT_TOOL_EXTRAS = ['web', 'sandbox', 'messages', 'directory'] as const
type AgentToolExtra = (typeof AGENT_TOOL_EXTRAS)[number]

/**
 * Where a NEW brief goes: `agents/<name>.md`, or inside a folder of agents
 * when one is given (`ops` → `agents/ops/<name>.md`). Reading an existing
 * brief by name is lib/agents/briefs.ts#findAgentBrief — the note may have
 * been moved into any folder since it was written.
 */
export function agentBriefPath(name: string, folder: string | null = null): string {
  const f = normaliseAgentFolder(folder)
  return f ? `agents/${f}/${name}.md` : `agents/${name}.md`
}

/**
 * A folder of agents, relative to `agents/`: one or more slug segments
 * (`ops`, `ops/reports`). `live` is the activation folder and never one.
 */
const AGENT_FOLDER_SEGMENT_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

/** `'/ops/reports/'`, `'agents/ops'` → `'ops/reports'`, `'ops'`; empty → null. */
export function normaliseAgentFolder(folder: string | null | undefined): string | null {
  if (!folder) return null
  const trimmed = folder.trim().replace(/^\/+|\/+$/g, '').replace(/^agents(\/|$)/, '')
  return trimmed || null
}

/** Why a folder string cannot hold agents, or null when it can. */
export function agentFolderProblem(folder: string | null | undefined): string | null {
  const f = normaliseAgentFolder(folder)
  if (!f) return null
  const segments = f.split('/')
  if (segments[0] === 'live') return '`agents/live/` holds activations — pick another folder name'
  for (const s of segments) {
    if (!AGENT_FOLDER_SEGMENT_RE.test(s)) return `"${s}" is not a folder name — lower-case letters, digits, - and _`
  }
  return null
}

/** The folder a brief path sits in, relative to `agents/`: `agents/ops/x.md` → `ops`; flat → ''. */
export function agentFolderOfPath(path: string): string {
  const m = /^agents\/(?:(.+)\/)?[^/]+\.md$/.exec(path)
  return m?.[1] ?? ''
}

/** The href of an agent's page — where notifications about it point. */
export function agentPageHref(name: string): string {
  return `/directory/${encodeURIComponent(`agent:${name}`)}`
}

/** The agent name an agent-page href names, or null. Inverse of agentPageHref (either encoding). */
export function agentNameOfHref(href: string | null | undefined): string | null {
  if (!href) return null
  const m = /^\/directory\/(agent(?::|%3A)[^/?#]+)/i.exec(href)
  if (!m) return null
  let id: string
  try {
    id = decodeURIComponent(m[1])
  } catch {
    return null
  }
  return id.startsWith('agent:') ? id.slice('agent:'.length) || null : null
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
  /** Agents (by name) this one may start with run_agent — empty means the tool is not offered. */
  agents: string[]
  /** `dry_run: true` — writes are recorded in the transcript instead of applied. */
  dryRun: boolean
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

  const agents = stringList(fm.agents, 'agents')
  if (!agents.ok) return agents
  for (const a of agents.list) {
    if (!AGENT_NAME_RE.test(a)) return { ok: false, error: `agent name "${a}" in \`agents\` is not valid` }
  }

  let dryRun = false
  if (fm.dry_run !== undefined && fm.dry_run !== null && fm.dry_run !== '') {
    const raw = typeof fm.dry_run === 'string' ? fm.dry_run.trim().toLowerCase() : fm.dry_run
    if (raw === true || raw === 'true') dryRun = true
    else if (raw !== false && raw !== 'false') return { ok: false, error: '`dry_run` must be true or false' }
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
      agents: agents.list,
      dryRun,
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
  | { kind: 'interval'; minutes: number } // `every: 15m`
  | { kind: 'cron'; expr: string; fields: CronFields } // `every: "*/10 9-17 * * 1-5"`

/** The `on:` map — what, besides the clock, wakes the agent. */
export interface AgentTriggers {
  /** Note globs (`**` any depth, `*` one segment); never matches under agents/. */
  context: string[]
  /** Connector name whose inbound webhook feeds this agent. */
  webhook: string | null
}

export interface AgentActivation {
  active: boolean
  /**
   * The clock: hourly/daily/weekly from `schedule`, interval/cron from `every`.
   * Null for a purely event-driven agent.
   */
  schedule: AgentSchedule | null
  /** The raw `every:` value as written (`15m`, a cron line), or null. */
  every: string | null
  /** Event triggers from an `on:` map, or null when `on` is absent / a weekday. */
  on: AgentTriggers | null
  /** Coalesce window for events (`debounce:`), in ms. Default 60 s. */
  debounceMs: number
  /** IANA zone named by the note, or null to fall back to the Space's. */
  timezone: string | null
  /**
   * Whose stored connections this agent spends, for connectors with an `auth:`
   * block (lib/connectors/auth.ts). A run has no person of its own, so one has
   * to be named — and it lives HERE, on the admin-only live note, rather than in
   * the member-writable brief. Writing your own agent must not be a way to make
   * it act as somebody with more access than you.
   *
   *   null            space connections only. An agent that reaches a
   *                   `mode: user` connector fails with a clear message rather
   *                   than silently borrowing whoever's token is nearest.
   *   <user id>       run as that member. Their access becomes the agent's
   *                   access, and the far side's audit log will name them.
   */
  runsAs: string | null
}

export type ParseActivationResult = { ok: true; activation: AgentActivation } | { ok: false; error: string }

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/
const EVERY_RE = /^(\d{1,4})\s*([mh])$/i
const DEBOUNCE_RE = /^(\d{1,5})\s*([sm])$/i
const WEBHOOK_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/
const MIN_INTERVAL_MINUTES = 5
const MAX_INTERVAL_MINUTES = 24 * 60
export const DEFAULT_DEBOUNCE_MS = 60_000
const MAX_DEBOUNCE_MS = 30 * 60_000
const MIN_DEBOUNCE_MS = 5_000

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

  const onIsMap = fm.on !== null && typeof fm.on === 'object' && !Array.isArray(fm.on)

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
        // `on: monday`, or — when `on` is a trigger map — `on: { weekday: monday, … }`.
        const onRaw = onIsMap ? (fm.on as Record<string, unknown>).weekday : fm.on
        const on = typeof onRaw === 'string' ? onRaw.trim().toLowerCase() : ''
        const weekday = (WEEKDAYS as readonly string[]).indexOf(on)
        if (weekday === -1) return { ok: false, error: '`on` must name a weekday (monday … sunday) for a weekly schedule' }
        schedule = { kind: 'weekly', ...at, weekday }
      }
    } else {
      return { ok: false, error: '`schedule` must be hourly, daily or weekly' }
    }
  }

  let every: string | null = null
  if (fm.every !== undefined && fm.every !== null && fm.every !== '') {
    if (schedule) return { ok: false, error: '`schedule` and `every` are exclusive — use one or the other' }
    const parsed = parseEvery(fm.every)
    if (!parsed.ok) return parsed
    schedule = parsed.schedule
    every = String(fm.every).trim()
  }

  let on: AgentTriggers | null = null
  if (onIsMap) {
    const parsed = parseTriggers(fm.on as Record<string, unknown>)
    if (!parsed.ok) return parsed
    on = parsed.triggers
  } else if (fm.on !== undefined && fm.on !== null && fm.on !== '' && schedule?.kind !== 'weekly') {
    if (typeof fm.on !== 'string' || !(WEEKDAYS as readonly string[]).includes(fm.on.trim().toLowerCase())) {
      return { ok: false, error: '`on` must be a weekday (for a weekly schedule) or a map with `context` / `webhook`' }
    }
  }

  let debounceMs = DEFAULT_DEBOUNCE_MS
  if (fm.debounce !== undefined && fm.debounce !== null && fm.debounce !== '') {
    const parsed = parseDebounce(fm.debounce)
    if (parsed === null) return { ok: false, error: '`debounce` must be like "30s" or "2m" (5s … 30m)' }
    debounceMs = parsed
  }

  let runsAs: string | null = null
  if (fm.runs_as !== undefined && fm.runs_as !== null && fm.runs_as !== '') {
    if (typeof fm.runs_as !== 'string' || !fm.runs_as.trim()) {
      return { ok: false, error: '`runs_as` must be the user id of the member whose connections this agent may spend' }
    }
    runsAs = fm.runs_as.trim()
  }

  if (active && !schedule && !on) return { ok: false, error: 'an active agent needs a `schedule`, an `every` interval or an `on` trigger' }
  return { ok: true, activation: { active, schedule, every, on, debounceMs, timezone, runsAs } }
}

/** `every:` → an interval (`15m`, `2h`) or a cron schedule. */
export function parseEvery(raw: unknown): { ok: true; schedule: AgentSchedule } | { ok: false; error: string } {
  const text = typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : ''
  if (!text) return { ok: false, error: '`every` must be an interval like "15m" / "2h" or a 5-field cron expression' }
  const m = EVERY_RE.exec(text)
  if (m) {
    const n = Number(m[1])
    const minutes = m[2].toLowerCase() === 'h' ? n * 60 : n
    if (minutes < MIN_INTERVAL_MINUTES || minutes > MAX_INTERVAL_MINUTES) {
      return { ok: false, error: `\`every\` must be between ${MIN_INTERVAL_MINUTES}m and 24h` }
    }
    return { ok: true, schedule: { kind: 'interval', minutes } }
  }
  const cron = parseCron(text)
  if (!cron.ok) return { ok: false, error: `\`every\` is not a valid interval or cron expression: ${cron.error}` }
  if (cronMinGapMinutes(cron.fields.minutes) < MIN_INTERVAL_MINUTES) {
    return { ok: false, error: `cron fires more often than every ${MIN_INTERVAL_MINUTES} minutes` }
  }
  return { ok: true, schedule: { kind: 'cron', expr: text, fields: cron.fields } }
}

/**
 * The smallest gap (minutes) between two firings a cron minute set allows
 * inside one hour, wrapping the hour boundary — `*` is 1, `0,30` is 30, `0`
 * is 60. The floor `every: 5m` enforces applies to crons too, or
 * `"* * * * *"` would be a way round it.
 */
function cronMinGapMinutes(minutes: number[]): number {
  const sorted = [...new Set(minutes)].sort((a, b) => a - b)
  if (sorted.length <= 1) return 60
  let min = 60
  for (let i = 0; i < sorted.length; i++) {
    const next = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + 60
    min = Math.min(min, next - sorted[i])
  }
  return min
}

/** `debounce:` → ms, or null when malformed / out of range. */
export function parseDebounce(raw: unknown): number | null {
  const text = typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? `${raw}s` : ''
  const m = DEBOUNCE_RE.exec(text)
  if (!m) return null
  const ms = Number(m[1]) * (m[2].toLowerCase() === 'm' ? 60_000 : 1_000)
  if (ms < MIN_DEBOUNCE_MS || ms > MAX_DEBOUNCE_MS) return null
  return ms
}

/** The `on:` map. */
export function parseTriggers(raw: Record<string, unknown>): { ok: true; triggers: AgentTriggers } | { ok: false; error: string } {
  for (const key of Object.keys(raw)) {
    if (key !== 'context' && key !== 'webhook' && key !== 'weekday') {
      return { ok: false, error: `\`on.${key}\` is not a trigger — use \`context\` (note globs) or \`webhook\` (connector name)` }
    }
  }
  const globs = stringList(raw.context, 'on.context')
  if (!globs.ok) return globs
  for (const g of globs.list) {
    const problem = globProblem(g)
    if (problem) return { ok: false, error: `\`on.context\` glob "${g}" ${problem}` }
  }
  let webhook: string | null = null
  if (raw.webhook !== undefined && raw.webhook !== null && raw.webhook !== '') {
    if (typeof raw.webhook !== 'string' || !WEBHOOK_NAME_RE.test(raw.webhook.trim())) {
      return { ok: false, error: '`on.webhook` must be a connector name (lowercase letters, digits, - and _)' }
    }
    webhook = raw.webhook.trim()
  }
  if (globs.list.length === 0 && !webhook) return { ok: false, error: '`on` must declare `context` globs and/or a `webhook` connector' }
  return { ok: true, triggers: { context: globs.list, webhook } }
}

/** A stable fingerprint of what dispatch derives from — the note is authoritative. */
export function scheduleHash(activation: AgentActivation, effectiveTz: string): string {
  // `runsAs` is deliberately absent: it changes whose credentials a run spends,
  // not when the run happens, and folding it in would reschedule every agent
  // whenever an admin repointed one.
  return JSON.stringify([activation.active, activation.schedule, effectiveTz, activation.every, activation.on, activation.debounceMs])
}

// ── Globs ────────────────────────────────────────────────────────────────────

const GLOB_MAX = 200

/**
 * `**` matches any number of path segments (including none), `*` matches
 * within one segment, everything else is literal. Anchored to the whole path.
 */
export function globToRegExp(glob: string): RegExp {
  let out = '^'
  const g = glob.trim().replace(/^\/+/, '')
  for (let i = 0; i < g.length; i++) {
    const c = g[i]
    if (c === '*') {
      if (g[i + 1] === '*') {
        // `**/` swallows the slash too, so `people/**` matches `people/x.md`
        // and `**/x.md` matches `x.md`.
        const slash = g[i + 2] === '/'
        out += slash ? '(?:.*/)?' : '.*'
        i += slash ? 2 : 1
      } else {
        out += '[^/]*'
      }
    } else if (/[.+?^${}()|[\]\\]/.test(c)) {
      out += `\\${c}`
    } else {
      out += c
    }
  }
  return new RegExp(out + '$')
}

/** Why a trigger glob is refused, or null when it is fine. */
export function globProblem(glob: string): string | null {
  const g = glob.trim()
  if (!g) return 'is empty'
  if (g.length > GLOB_MAX) return `is longer than ${GLOB_MAX} characters`
  if (g.includes('..')) return 'may not contain ".."'
  const re = globToRegExp(g)
  // A trigger may never fire on the agents' own notes: an agent that reacts to
  // a brief or an activation note is a loop waiting to happen.
  for (const probe of ['agents/probe.md', 'agents/live/probe.md', 'agents/probe/index.md']) {
    if (re.test(probe)) return 'could match under agents/ — name a folder such as people/** instead'
  }
  return null
}

/** Does `path` match any of the globs? Paths under agents/ never match. */
export function matchesAnyGlob(path: string, globs: string[]): boolean {
  if (path === 'agents' || path.startsWith('agents/')) return false
  return globs.some((g) => globRegExp(g).test(path))
}

const globCache = new Map<string, RegExp>()

function globRegExp(glob: string): RegExp {
  let re = globCache.get(glob)
  if (!re) {
    re = globToRegExp(glob)
    globCache.set(glob, re)
  }
  return re
}

// ── Cron (5 fields, minimal: `*`, `*\/n`, lists, ranges, `a-b/n`) ────────────

interface CronFields {
  minutes: number[]
  hours: number[]
  daysOfMonth: number[] | null // null = every
  months: number[] | null
  daysOfWeek: number[] | null // 0 = Sunday (7 folded to 0)
}

const CRON_RANGES: [number, number][] = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
]

function parseCronField(field: string, min: number, max: number): number[] | null {
  const out = new Set<number>()
  for (const part of field.split(',')) {
    const m = /^(\*|\d{1,2}(?:-\d{1,2})?)(?:\/(\d{1,2}))?$/.exec(part.trim())
    if (!m) return null
    let lo = min
    let hi = max
    if (m[1] !== '*') {
      const [a, b] = m[1].split('-').map(Number)
      lo = a
      hi = b === undefined ? (m[2] ? max : a) : b
      if (lo < min || hi > max || lo > hi) return null
    }
    const step = m[2] ? Number(m[2]) : 1
    if (step < 1) return null
    for (let v = lo; v <= hi; v += step) out.add(v)
  }
  return [...out].sort((a, b) => a - b)
}

function parseCron(expr: string): { ok: true; fields: CronFields } | { ok: false; error: string } {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return { ok: false, error: 'expected 5 fields (minute hour day-of-month month day-of-week)' }
  const parsed: number[][] = []
  for (let i = 0; i < 5; i++) {
    const [min, max] = CRON_RANGES[i]
    const values = parseCronField(parts[i], min, max)
    if (!values) return { ok: false, error: `field ${i + 1} ("${parts[i]}") is not valid` }
    parsed.push(values)
  }
  const every = (values: number[], min: number, max: number) => values.length === max - min + 1
  const dow = [...new Set(parsed[4].map((d) => (d === 7 ? 0 : d)))].sort((a, b) => a - b)
  return {
    ok: true,
    fields: {
      minutes: parsed[0],
      hours: parsed[1],
      daysOfMonth: every(parsed[2], 1, 31) ? null : parsed[2],
      months: every(parsed[3], 1, 12) ? null : parsed[3],
      daysOfWeek: dow.length === 7 ? null : dow,
    },
  }
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
  if (schedule.kind === 'interval') {
    // Aligned to epoch multiples so `every: 15m` fires at :00/:15/:30/:45 and a
    // late tick doesn't drift the grid.
    const step = schedule.minutes * 60_000
    return new Date((Math.floor(after.getTime() / step) + 1) * step)
  }
  if (schedule.kind === 'cron') return nextCronOccurrence(schedule.fields, after, tz)
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

/**
 * The next wall-clock minute in `tz` matching the cron fields, strictly after
 * `after`. Day-of-month and day-of-week are ANDed when both are restricted
 * (simpler to reason about than vixie-cron's OR; documented). Scans up to 400
 * days, minute candidates only on matching days.
 */
function nextCronOccurrence(f: CronFields, after: Date, tz: string): Date {
  const now = wallClockAt(after, tz)
  for (let d = 0; d < 400; d++) {
    const cal = addDays(now.year, now.month, now.day, d)
    if (f.months && !f.months.includes(cal.month)) continue
    if (f.daysOfMonth && !f.daysOfMonth.includes(cal.day)) continue
    if (f.daysOfWeek) {
      const wd = new Date(Date.UTC(cal.year, cal.month - 1, cal.day)).getUTCDay()
      if (!f.daysOfWeek.includes(wd)) continue
    }
    for (const hour of f.hours) {
      if (d === 0 && hour < now.hour) continue
      for (const minute of f.minutes) {
        if (d === 0 && hour === now.hour && minute <= now.minute) continue
        const instant = zonedWallToInstant(tz, cal.year, cal.month, cal.day, hour, minute)
        if (instant.getTime() > after.getTime()) return instant
      }
    }
  }
  return new Date(after.getTime() + 400 * 86_400_000)
}

/** Human label for the roster ("Daily at 07:00", "Weekly on Monday at 09:30"). */
export function describeSchedule(schedule: AgentSchedule | null, tz: string | null): string {
  if (!schedule) return 'No schedule'
  const hhmm = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  const suffix = tz ? ` (${tz})` : ''
  if (schedule.kind === 'hourly') return 'Every hour'
  if (schedule.kind === 'interval') {
    const m = schedule.minutes
    return m % 60 === 0 ? `Every ${m / 60 === 1 ? 'hour' : `${m / 60} hours`}` : `Every ${m} minutes`
  }
  if (schedule.kind === 'cron') return `Cron ${schedule.expr}${suffix}`
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

/** Human label for the `on:` triggers ("when people/** changes · webhook hubspot"). */
export function describeTriggers(on: AgentTriggers | null): string | null {
  if (!on) return null
  const parts: string[] = []
  if (on.context.length) parts.push(`when ${on.context.join(', ')} changes`)
  if (on.webhook) parts.push(`webhook ${on.webhook}`)
  return parts.join(' · ') || null
}

/** An interval/cron schedule back to its `every:` text (null for the clock kinds). */
function everyText(schedule: AgentSchedule | null): string | null {
  if (!schedule) return null
  if (schedule.kind === 'interval') return schedule.minutes % 60 === 0 ? `${schedule.minutes / 60}h` : `${schedule.minutes}m`
  if (schedule.kind === 'cron') return schedule.expr
  return null
}

export function newActivationNote(input: {
  active: boolean
  schedule: AgentSchedule | null
  on?: AgentTriggers | null
  /** ms; omitted or the default writes no `debounce:` line. */
  debounceMs?: number | null
  timezone?: string | null
}): string {
  const lines = ['---', `type: ${ACTIVATION_TYPE}`, `active: ${input.active ? 'true' : 'false'}`]
  const s = input.schedule
  if (s?.kind === 'interval' || s?.kind === 'cron') {
    lines.push(`every: ${yamlString(everyText(s) ?? '')}`)
  } else if (s) {
    lines.push(`schedule: ${s.kind}`)
    if (s.kind !== 'hourly') {
      lines.push(`at: "${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}"`)
    }
    if (s.kind === 'weekly') lines.push(`on: ${WEEKDAYS[s.weekday]}`)
  }
  const on = input.on
  if (on && (on.context.length || on.webhook)) {
    // A weekly schedule's weekday moves INTO the map (`on.weekday`) so both fit.
    if (s?.kind === 'weekly') lines.pop()
    lines.push('on:')
    if (s?.kind === 'weekly') lines.push(`  weekday: ${WEEKDAYS[s.weekday]}`)
    if (on.context.length) lines.push(`  context: [${on.context.map(yamlString).join(', ')}]`)
    if (on.webhook) lines.push(`  webhook: ${on.webhook}`)
  }
  const d = input.debounceMs
  if (typeof d === 'number' && d !== DEFAULT_DEBOUNCE_MS) {
    lines.push(`debounce: ${d % 60_000 === 0 ? `${d / 60_000}m` : `${Math.round(d / 1000)}s`}`)
  }
  if (input.timezone) lines.push(`timezone: ${input.timezone}`)
  lines.push(
    '---',
    '',
    'Activation for this agent — written by a space admin. Only `active`, `schedule`, `at`, `on`, `every`, `debounce`, `timezone` and `runs_as` are read.',
    '',
  )
  return lines.join('\n')
}
