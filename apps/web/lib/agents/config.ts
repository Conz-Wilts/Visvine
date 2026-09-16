/**
 * The agent note contract — pure, no I/O (tests import this directly).
 *
 * An agent is a FOLDER, `agents/<name>/`, and ONE note defines it — the
 * folder's index. What the agent is and whether it runs are the same note,
 * because they are written by the same people and read as one thing:
 *
 *   agents/<name>/index.md      the BRIEF — what the agent is AND when it runs
 *   ---
 *   type: agent
 *   title: Weekly digest
 *   description: One line, shown on the roster
 *   model: anthropic/claude-sonnet-5  # OPTIONAL — omit to use the space's model
 *   connectors: [hubspot]             # declared reach — names under connectors/
 *   tools: [web]                      # optional extras: web (fetch_url — any public page,
 *                                     #   a search engine's results included),
 *                                     #   directory (create_node/link_nodes), actions (run_action)
 *   agents: [digest]                  # optional — agents this one may chain into with run_agent
 *                                     #   (omit it and any agent in the space may be chained)
 *   dry_run: true                     # optional — writes are captured in the transcript, not applied
 *   max_turns: 40                     # optional, 1..200
 *
 *   active: true                      # ── the activation, same frontmatter ──
 *   schedule: daily                   # hourly | daily | weekly   (XOR with `every`)
 *   at: "07:00"                       # daily / weekly
 *   on: monday                        # weekly (a bare string is the weekday)
 *   every: 15m                        # Nm | Nh (1m..24h) or a 5-field cron
 *   on:                               # a MAP declares event triggers
 *     context: ["people/**"]          #   note created/saved/renamed-to under a glob
 *     webhook: hubspot                #   connector whose inbound hook feeds this agent
 *     weekday: monday                 #   only with schedule: weekly (the bare string, moved here)
 *   debounce: 2m                      # coalesce window: Ns | Nm, default 60s, max 30m
 *   timezone: Pacific/Auckland        # required with a clock; UTC only for legacy notes
 *   runs_as: <user id>                # admin-only unless you name yourself
 *   ---
 *   The body is the brief. It is WRAPPED (a fixed preamble + the body), not
 *   passed verbatim as the whole system prompt.
 *
 *   An active agent needs at least one of `schedule`, `every` or `on`.
 *
 *   agents/<name>/<anything>.md  the agent's OWN notes — where its runs write
 *                               by default (a digest, a report, the state it
 *                               keeps between runs). The one place under
 *                               agents/ an agent may write, and only its own.
 *
 * `agents/<name>/activation.md` was a second note holding the activation half.
 * It is still READ when a brief carries no activation keys, so an agent
 * written before the merge keeps running; `db:agents:activation` folds it in
 * and removes it. Nothing writes one any more.
 *
 * Budget is deliberately NOT here: it lives on the AgentState row because
 * money is admin-read while notes are member-read.
 *
 * Both parsers follow the connector precedent — `{ ok, … } | { ok: false,
 * error }` — so a broken note still describes itself on the roster. They read
 * the SAME frontmatter now: `parseAgentBrief` ignores the activation keys and
 * `parseAgentActivation` ignores the brief's.
 */
import { inSpace, stripSpacePrefix } from '@/lib/spaces/shared/spaceUrl'
import { parentAdministers, reachesRoom, shareTargets } from '@/lib/spaces/subspaces'
import { joinFrontmatter, parseFrontmatter, splitFrontmatter } from '@/lib/notes/shared/markdown'
import type { NoteFrontmatter } from '@/lib/notes/shared/types'
import { parseModelRef, type ModelRef } from './registry'

export const AGENT_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/
const AGENT_TYPE = 'agent'
/** The type a pre-merge standalone activation note carries. Read, never written. */
const ACTIVATION_TYPE = 'agent-activation'
const DEFAULT_MAX_TURNS = 40
const MAX_MAX_TURNS = 200
export const AGENT_TOOL_EXTRAS = ['web', 'sandbox', 'messages', 'directory', 'machine', 'actions'] as const
export type AgentToolExtra = (typeof AGENT_TOOL_EXTRAS)[number]

/**
 * What each `tools:` extra adds, in the words the create surface and the
 * agent's settings show beside its checkbox. Context reads and writes are
 * always available and are not listed — an agent with no extras still reads
 * and writes notes.
 */
export const AGENT_TOOL_OPTIONS: ReadonlyArray<{ id: AgentToolExtra; label: string; description: string }> = [
  { id: 'web', label: 'Web', description: 'Read public web pages, search engines included (fetch_url). A machine renders what needs JavaScript.' },
  { id: 'directory', label: 'Directory', description: 'Create records and link them (create_node, link_nodes).' },
  // `machine`, `sandbox` and `messages` are deliberately absent. An agent gets
  // a computer whenever the space HAS one (lib/agents/tools.ts), so it is not a
  // checkbox, and that computer is what `sandbox` once promised; `messages`
  // grants nothing at all now. Old briefs that list any of them still parse —
  // AGENT_TOOL_EXTRAS keeps the names.
  {
    id: 'actions',
    label: 'Actions',
    description: 'Everything else the platform can be asked to do (run_action) — events, the Drive, tools, connectors — as its author, with their access.',
  },
]

/** The agent's folder: `agents/<name>`. */
export function agentFolderPath(name: string): string {
  return `agents/${name}`
}

/** The brief — the agent folder's index. */
export function agentBriefPath(name: string): string {
  return `${agentFolderPath(name)}/index.md`
}

/** The flat alias a stale link or client may still hold: `agents/<name>.md`. */
export function agentBriefAliasPath(name: string): string {
  return `${agentFolderPath(name)}.md`
}

/**
 * The pre-merge activation note. An agent written before the activation moved
 * into the brief still has one, and it is still read when the brief carries no
 * activation keys of its own — never written. `db:agents:activation` folds it in.
 */
export function agentActivationPath(name: string): string {
  return `${agentFolderPath(name)}/activation.md`
}

/**
 * The href of an agent's page — its node page, which is the ONE agent surface:
 * the Agent tab is where it is configured AND where its runs are watched, the
 * way a Profile tab belongs to a person node. There is no agents tool, rail row
 * or roster page; a run to open rides along as `?run=<id>`.
 */
export function agentPageHref(name: string, runId?: string | null, spaceId?: string): string {
  const path = `/directory/${encodeURIComponent(`agent:${name}`)}`
  const href = runId ? `${path}?run=${encodeURIComponent(runId)}` : path
  return spaceId ? inSpace(spaceId, href) : href
}

/** The agent name an agent-page href names, or null. Inverse of agentPageHref (either encoding). */
export function agentNameOfHref(href: string | null | undefined): string | null {
  if (!href) return null
  const m = /^\/directory\/(agent(?::|%3A)[^/?#]+)/i.exec(stripSpacePrefix(href))
  if (!m) return null
  let id: string
  try {
    id = decodeURIComponent(m[1])
  } catch {
    return null
  }
  return id.startsWith('agent:') ? id.slice('agent:'.length) || null : null
}

// ── The brief ────────────────────────────────────────────────────────────────

export interface AgentBrief {
  title: string
  description: string | null
  /**
   * The raw `model:` value, e.g. `anthropic/claude-sonnet-5` — or null, which
   * is the ordinary case: an agent runs on the SPACE's model (the first
   * runnable note under models/, lib/agents/spaceModels.ts) unless it
   * pins one of its own. Which model a space runs on is a decision it makes
   * once, beside the key that pays for it.
   */
  model: string | null
  /** The parsed pin, or null when the brief names none and the space decides. */
  modelRef: ModelRef | null
  connectors: string[]
  tools: AgentToolExtra[]
  /** Agents (by name) this one may start with run_agent — empty means the tool is not offered. */
  agents: string[]
  /**
   * `share: all` or `share: [room ids]` — which sub-spaces of this space this
   * brief is read into (as `parent/agents/<name>/index.md`, read-only), per
   * docs/sub-spaces.md. 'none' is the ordinary brief.
   */
  share: 'none' | 'all' | string[]
  /**
   * `share_as: use` (default) — a room's agent may start it with run_agent
   * and it runs HERE, as its own author. `share_as: run-in` — a copy runs
   * inside each shared room the house governs, over that room's notes
   * (lib/agents/hooks.ts#syncSharedCopies).
   */
  shareAs: 'use' | 'run-in'
  /** `dry_run: true` — writes are recorded in the transcript instead of applied. */
  dryRun: boolean
  maxTurns: number
  /**
   * The brief's `tags:` — how a space groups its agents (Investments,
   * Operations…). The roster reads the first one as the group; the agent's
   * node carries them all, so the Directory's tag filters reach agents too.
   */
  tags: string[]
  /** The system-prompt body (markdown after the frontmatter), trimmed. */
  body: string
}

export type ParseBriefResult = { ok: true; brief: AgentBrief } | { ok: false; error: string }

const SPACE_ID_RE = /^[a-z0-9][a-z0-9:._-]{0,80}$/i

/**
 * Which rooms get a run-in copy of a house brief: the rooms the share
 * reaches AND the house governs — a copy runs as the house brief's author,
 * whose standing in the room comes from governance and nowhere else
 * (docs/sub-spaces.md). Pure: the fan-out and the settings form both read it.
 */
export function copyRooms<T extends { id: string; parentId?: string | null; parentAdmins?: boolean | null }>(
  brief: Pick<AgentBrief, 'share' | 'shareAs'>,
  rooms: readonly T[],
): T[] {
  if (brief.shareAs !== 'run-in' || brief.share === 'none') return []
  return rooms.filter((r) => reachesRoom(brief.share, r.id) && parentAdministers(r))
}

/** The rooms a run-in share names that the house does NOT govern — no copy runs there, and the form says so. */
export function ungovernedCopyRooms<T extends { id: string; parentId?: string | null; parentAdmins?: boolean | null }>(
  brief: Pick<AgentBrief, 'share' | 'shareAs'>,
  rooms: readonly T[],
): T[] {
  if (brief.shareAs !== 'run-in' || brief.share === 'none') return []
  return rooms.filter((r) => reachesRoom(brief.share, r.id) && !parentAdministers(r))
}

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
  // Optional. A brief that says nothing runs on the space's model; one that
  // says something must say it correctly, so a typo is refused here rather
  // than discovered at 3am by the run it silently mis-pointed.
  const pinned = typeof fm.model === 'string' && fm.model.trim().length > 0
  const model = pinned ? parseModelRef(fm.model) : null
  if (model && !model.ok) return { ok: false, error: model.error }

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

  const tags = stringList(fm.tags, 'tags')
  if (!tags.ok) return tags

  let share: AgentBrief['share'] = 'none'
  if (fm.share !== undefined && fm.share !== null && fm.share !== '' && fm.share !== false) {
    const raw = typeof fm.share === 'string' ? fm.share.trim().toLowerCase() : fm.share
    if (raw !== 'none') {
      if (typeof raw !== 'string' && !Array.isArray(raw) && raw !== true) {
        return { ok: false, error: '`share` must be `all`, a list of sub-space ids, or absent' }
      }
      const targets = shareTargets({ share: raw })
      if (targets === 'none') return { ok: false, error: '`share` must be `all`, a list of sub-space ids, or absent' }
      if (Array.isArray(targets)) {
        for (const id of targets) {
          if (!SPACE_ID_RE.test(id)) return { ok: false, error: `"${id}" in \`share\` is not a space id` }
        }
      }
      share = targets
    }
  }
  let shareAs: AgentBrief['shareAs'] = 'use'
  if (fm.share_as !== undefined && fm.share_as !== null && fm.share_as !== '') {
    const raw = typeof fm.share_as === 'string' ? fm.share_as.trim().toLowerCase() : fm.share_as
    if (raw === 'run-in' || raw === 'run_in' || raw === 'runin') shareAs = 'run-in'
    else if (raw !== 'use') return { ok: false, error: '`share_as` must be `use` or `run-in`' }
    if (share === 'none') return { ok: false, error: '`share_as` needs a `share` to apply to' }
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
      model: pinned ? String(fm.model).trim() : null,
      modelRef: model?.ok ? model.ref : null,
      connectors: connectors.list,
      tools: extras,
      agents: agents.list,
      share,
      shareAs,
      dryRun,
      maxTurns,
      tags: [...new Set(tags.list.map((t) => t.trim()).filter(Boolean))],
      body: trimmedBody,
    },
  }
}

// ── The activation ───────────────────────────────────────────────────────────

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

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
   * to be named — and it lives HERE, on the activation, where the write gate
   * lets a member name only themselves and an admin anyone. Writing your own
   * agent must not be a way to make it act as somebody with more access than you.
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
const MIN_INTERVAL_MINUTES = 1
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

/**
 * The activation schedule a caller asked for, from the loose fields both doors
 * take: `schedule` (hourly/daily/weekly, with `at` and a weekday) XOR `every`
 * (an interval or a cron). Neither means a trigger-only agent, which is a
 * schedule of null rather than an error — `activateAgent` is what insists on
 * at least one of schedule/interval/trigger, in one place.
 *
 * Shared by `PATCH /api/spaces/<id>/agents/<name>` and the
 * `activate_agent` action so the two cannot drift: turning an agent on means
 * the same thing whichever door it came through.
 */
export function parseScheduleFields(input: {
  schedule?: unknown
  at?: unknown
  weekday?: unknown
  every?: unknown
}): { ok: true; schedule: AgentSchedule | null } | { ok: false; error: string } {
  const kind = typeof input.schedule === 'string' ? input.schedule.toLowerCase() : ''
  const every = typeof input.every === 'string' ? input.every.trim() : ''
  if (every) {
    if (kind && kind !== 'every' && kind !== 'none') return { ok: false, error: '`schedule` and `every` are exclusive — give one' }
    return parseEvery(every)
  }
  if (!kind || kind === 'none' || kind === 'every') return { ok: true, schedule: null }
  if (kind === 'hourly') return { ok: true, schedule: { kind: 'hourly' } }
  if (kind !== 'daily' && kind !== 'weekly') return { ok: false, error: '`schedule` must be hourly, daily or weekly' }
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(typeof input.at === 'string' ? input.at.trim() : '')
  if (!m) return { ok: false, error: `a ${kind} schedule needs \`at\`, a time like "07:00"` }
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (kind === 'daily') return { ok: true, schedule: { kind: 'daily', hour, minute } }
  const weekday = (WEEKDAYS as readonly string[]).indexOf(typeof input.weekday === 'string' ? input.weekday.toLowerCase() : '')
  if (weekday === -1) return { ok: false, error: 'a weekly schedule needs `weekday` — monday, tuesday, …' }
  return { ok: true, schedule: { kind: 'weekly', hour, minute, weekday } }
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
  // whenever somebody repointed one.
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
  // a brief, an activation or a note another run wrote is a loop waiting to happen.
  // (A sub-space's briefs, read through `subspaces/<id>/agents/`, are kept
  // out at match time instead — `matchesAnyGlob` — so `subspaces/**` stays a
  // legal way for a parent's agent to watch its public sub-spaces.)
  for (const probe of ['agents/probe/index.md', 'agents/probe/activation.md', 'agents/probe/report.md', 'agents/probe.md']) {
    if (re.test(probe)) return 'could match under agents/ — name a folder such as people/** instead'
  }
  return null
}

/**
 * Does `path` match any of the globs? Paths under agents/ never match — nor
 * a sub-space's agents/ read through `subspaces/<id>/` (lib/spaces/subspaces.ts):
 * another space's briefs are no more a trigger than this one's.
 */
export function matchesAnyGlob(path: string, globs: string[]): boolean {
  if (path === 'agents' || path.startsWith('agents/')) return false
  if (/^subspaces\/[^/]+\/agents(\/|$)/.test(path)) return false
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
    // Only when the author pinned one. A brief with no `model:` runs on the
    // SPACE's model, which is the ordinary case — and writing a guess here is
    // how a new agent came to name a provider its space had never heard of.
    ...(input.model?.trim() ? [`model: ${input.model.trim()}`] : []),
    `connectors: [${(input.connectors ?? []).join(', ')}]`,
    ...(input.tools?.length ? [`tools: [${input.tools.join(', ')}]`] : []),
    `max_turns: ${DEFAULT_MAX_TURNS}`,
    // The activation lives here too. A new brief is off: turning it on is a
    // deliberate act, and it writes the schedule keys in beside this one.
    'active: false',
    '---',
    '',
  ]
  const body = input.body?.trim() || defaultBriefBody(title, input.name)
  return `${lines.join('\n')}${body}\n`
}

/**
 * The scaffold a brief starts from when nobody wrote one: the three questions
 * every brief answers, with the agent's own folder as the default answer to
 * the third. Written so the person keeps the headings and replaces the prose.
 */
function defaultBriefBody(title: string, name: string): string {
  return [
    `You are ${title}.`,
    '',
    '## Each run',
    'Say what to do on every run, as a standing instruction — not a one-off request.',
    '',
    '## Read',
    'Which notes or folders to read first (list_context / search_context / read_context), and what counts as "changed since last run".',
    '',
    '## Produce',
    'What the output is — a digest, a report, an updated record — and the shape it should take: headings, a table, a list of links.',
    '',
    '## Write to',
    `Where it goes. Your own folder, agents/${name}/, is the default — a dated note (agents/${name}/2026-01-31.md) for something periodic, ` +
      `one fixed note for something you keep current. Name another folder only when the notes belong to it (a person's folder, reports/).`,
  ].join('\n')
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

/**
 * The activation half of an agent's frontmatter, as keys — `active`, the
 * clock, the triggers, the debounce and the zone. Written INTO the brief
 * (withActivation), which is the only note an agent has.
 */
export function activationFrontmatter(input: {
  active: boolean
  schedule: AgentSchedule | null
  on?: AgentTriggers | null
  /** ms; omitted or the default writes no `debounce:` key. */
  debounceMs?: number | null
  timezone?: string | null
}): NoteFrontmatter {
  const fm: NoteFrontmatter = { active: input.active }
  const s = input.schedule
  if (s?.kind === 'interval' || s?.kind === 'cron') {
    fm.every = everyText(s) ?? ''
  } else if (s) {
    fm.schedule = s.kind
    if (s.kind !== 'hourly') fm.at = `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`
    if (s.kind === 'weekly') fm.on = WEEKDAYS[s.weekday]
  }
  const on = input.on
  if (on && (on.context.length || on.webhook)) {
    // A weekly schedule's weekday moves INTO the map (`on.weekday`) so both fit.
    const map: Record<string, unknown> = {}
    if (s?.kind === 'weekly') map.weekday = WEEKDAYS[s.weekday]
    if (on.context.length) map.context = [...on.context]
    if (on.webhook) map.webhook = on.webhook
    fm.on = map
  }
  const d = input.debounceMs
  if (typeof d === 'number' && d !== DEFAULT_DEBOUNCE_MS) {
    fm.debounce = d % 60_000 === 0 ? `${d / 60_000}m` : `${Math.round(d / 1000)}s`
  }
  if (input.timezone) fm.timezone = input.timezone
  return fm
}

/**
 * The frontmatter keys the activation owns. Every one is cleared before a new
 * activation is written, so turning a daily agent into an interval one leaves
 * no `at:` behind for the parser to argue with. `runs_as` is NOT in the list:
 * it says whose credentials a run spends, is gated separately
 * (contextService#activationRunsAsDenial) and survives every on/off.
 */
const ACTIVATION_KEYS = ['active', 'schedule', 'at', 'on', 'every', 'debounce', 'timezone'] as const

/**
 * Does this frontmatter carry an activation at all? A brief written before the
 * merge does not, and its pre-merge `activation.md` is read instead.
 */
export function isLegacyActivationFrontmatter(fm: NoteFrontmatter): boolean {
  return typeof fm.type === 'string' && fm.type.trim().toLowerCase() === ACTIVATION_TYPE
}

export function hasActivationFrontmatter(fm: NoteFrontmatter): boolean {
  return ACTIVATION_KEYS.some((k) => fm[k] !== undefined && fm[k] !== null && fm[k] !== '')
}

/**
 * The brief with a new activation written into its frontmatter — the one write
 * that turns an agent on or off. The body and every brief key are untouched;
 * only the activation keys are replaced.
 */
export function withActivation(
  briefContent: string,
  input: Parameters<typeof activationFrontmatter>[0],
): string {
  const fm = { ...parseFrontmatter(briefContent) }
  for (const key of ACTIVATION_KEYS) delete fm[key]
  return joinFrontmatter({ ...fm, ...activationFrontmatter(input) }, splitFrontmatter(briefContent).body)
}

/** The brief with `active: false` written in, leaving the rest of it alone. */
export function withActiveFalse(briefContent: string): string {
  const fm = parseFrontmatter(briefContent)
  return joinFrontmatter({ ...fm, active: false }, splitFrontmatter(briefContent).body)
}
