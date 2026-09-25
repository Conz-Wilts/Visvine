/**
 * How an agent RUNS, as a record — pure, no I/O.
 *
 * An agent is two things kept in two places. The note `agents/<name>/index.md`
 * is what it IS: `type`, `title`, `description`, `tags` and the brief. The
 * `agent_state` row (with `agent_subscriptions` for who it runs for) is how it
 * RUNS: model, reach, schedule, identity, share and caps. Anything a machine
 * enforces or schedules on is a column; anything a model or a person reads as
 * meaning stays in context.
 *
 * The parsers in ../config.ts stay the one definition of what a valid value
 * is: a config is checked by rendering it as the frontmatter those parsers
 * read (`configFrontmatter`) and parsing it back, so the row and the older
 * note shape can never disagree about a rule.
 */
import type { NoteFrontmatter } from '@/lib/notes/shared/types'
import {
  activationFrontmatter,
  parseAgentActivation,
  parseAgentBrief,
  type AgentActivation,
  type AgentBrief,
  type AgentSchedule,
  type AgentToolExtra,
  type AgentTriggers,
} from '../config'
import { runsForFrontmatter, type RunsForEntry } from './runsFor'
import { inputsFrontmatter, parseAgentInputs, parseInputValues, type AgentInput, type InputValues } from './inputs'

/** Every frontmatter key the row owns. A brief note carries none of them. */
const RUN_KEYS = [
  'model',
  'fallback_model',
  'connectors',
  'tools',
  'agents',
  'share',
  'share_as',
  'dry_run',
  'max_turns',
  'for',
  'inputs',
  'input_values',
  'runs_as',
  'active',
  'schedule',
  'at',
  'on',
  'every',
  'debounce',
  'timezone',
] as const

export interface AgentConfig {
  /** A pinned `<provider>/<id>`; null runs on the space's model. */
  model: string | null
  /** Tried once when a run on `model` ends short; null for none. */
  fallbackModel: string | null
  connectors: string[]
  tools: AgentToolExtra[]
  agents: string[]
  share: 'none' | 'all' | string[]
  shareAs: 'use' | 'run-in'
  dryRun: boolean
  maxTurns: number
  runsFor: RunsForEntry[]
  inputs: AgentInput[]
  inputValues: InputValues
  active: boolean
  schedule: AgentSchedule | null
  on: AgentTriggers | null
  debounceMs: number
  timezone: string | null
  runsAs: string | null
}

export type AgentConfigPatch = Partial<AgentConfig>

const present = (v: unknown) => v !== undefined && v !== null && v !== ''

/** The run keys a note's frontmatter carries, in RUN_KEYS order. */
export function runKeysOf(fm: NoteFrontmatter): string[] {
  return RUN_KEYS.filter((k) => present(fm[k]))
}

/** The frontmatter with every run key taken out. */
export function stripRunKeys(fm: NoteFrontmatter): NoteFrontmatter {
  const out: NoteFrontmatter = { ...fm }
  for (const k of RUN_KEYS) delete out[k]
  return out
}

/** The config the parsed brief and activation describe. */
export function configOf(brief: AgentBrief, activation: AgentActivation): AgentConfig {
  return {
    model: brief.model,
    fallbackModel: brief.fallbackModel,
    connectors: brief.connectors,
    tools: brief.tools,
    agents: brief.agents,
    share: brief.share,
    shareAs: brief.shareAs,
    dryRun: brief.dryRun,
    maxTurns: brief.maxTurns,
    runsFor: brief.runsFor,
    inputs: brief.inputs,
    inputValues: brief.inputValues,
    active: activation.active,
    schedule: activation.schedule,
    on: activation.on,
    debounceMs: activation.debounceMs,
    timezone: activation.timezone,
    runsAs: activation.runsAs,
  }
}

/**
 * The run keys of a note written in the older shape, as a config — or the
 * parser's own words for why they do not make one.
 */
export function configFromFrontmatter(fm: NoteFrontmatter, body: string): { ok: true; config: AgentConfig } | { ok: false; error: string } {
  const brief = parseAgentBrief({ ...fm, type: 'agent' }, body.trim() || '.')
  if (!brief.ok) return brief
  const activation = parseAgentActivation(fm)
  if (!activation.ok) return activation
  return { ok: true, config: configOf(brief.brief, activation.activation) }
}

/** A config as the frontmatter keys the parsers read. Defaults write nothing. */
export function configFrontmatter(c: AgentConfig): NoteFrontmatter {
  const fm: NoteFrontmatter = {}
  if (c.model) fm.model = c.model
  if (c.fallbackModel) fm.fallback_model = c.fallbackModel
  if (c.connectors.length) fm.connectors = [...c.connectors]
  if (c.tools.length) fm.tools = [...c.tools]
  if (c.agents.length) fm.agents = [...c.agents]
  if (c.share !== 'none') {
    fm.share = c.share === 'all' ? 'all' : [...c.share]
    if (c.shareAs === 'run-in') fm.share_as = 'run-in'
  }
  if (c.dryRun) fm.dry_run = true
  fm.max_turns = c.maxTurns
  const forBlock = runsForFrontmatter(c.runsFor)
  if (forBlock) fm.for = forBlock
  const inputsBlock = inputsFrontmatter(c.inputs)
  if (inputsBlock) fm.inputs = inputsBlock
  if (Object.keys(c.inputValues).length) fm.input_values = { ...c.inputValues }
  if (c.runsAs) fm.runs_as = c.runsAs
  Object.assign(fm, activationFrontmatter({ active: c.active, schedule: c.schedule, on: c.on, debounceMs: c.debounceMs, timezone: c.timezone }))
  return fm
}

/**
 * The frontmatter every reader parses: the note's own keys with the record's
 * run keys laid over them. `config` null is a row from before the record — the
 * note's own keys are then still the answer.
 */
export function effectiveFrontmatter(noteFm: NoteFrontmatter, config: AgentConfig | null): NoteFrontmatter {
  if (!config) return noteFm
  return { ...stripRunKeys(noteFm), ...configFrontmatter(config) }
}

/** `base` with `patch` applied, checked by the same parsers a brief is. */
export function applyConfigPatch(
  base: AgentConfig,
  patch: AgentConfigPatch,
): { ok: true; config: AgentConfig } | { ok: false; error: string } {
  const merged: AgentConfig = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) (merged as unknown as Record<string, unknown>)[k] = v
  }
  // `share_as` means nothing without a share; `use` is its default.
  if (merged.share === 'none' || (Array.isArray(merged.share) && merged.share.length === 0)) {
    merged.share = 'none'
    merged.shareAs = 'use'
  }
  const round = configFromFrontmatter(configFrontmatter(merged), '.')
  if (!round.ok) return round
  return { ok: true, config: round.config }
}

/** The config a brand-new agent starts with: off, reaching nothing. */
export function defaultAgentConfig(): AgentConfig {
  const round = configFromFrontmatter({}, '.')
  if (!round.ok) throw new Error(round.error)
  return round.config
}

// ── The row ─────────────────────────────────────────────────────────────────

/** The `agent_state` columns the record is stored in. */
export interface AgentConfigColumns {
  model: string | null
  fallbackModel: string | null
  connectors: string[]
  tools: string[]
  agents: string[]
  schedule: unknown
  timezone: string | null
  runsAs: string | null
  shareMode: string
  shareRooms: string[]
  shareAs: string
  dryRun: boolean
  maxTurns: number
  active: boolean
  triggersJson: unknown
  debounceMs: number
  inputs: unknown
  inputValues: unknown
}

/** The `agent_subscriptions` columns one runs-for entry is stored in. */
export interface RunsForColumns {
  userId: string
  at: string | null
  timezone: string | null
  model: string | null
  inputs: unknown
}

const pad = (n: number) => String(n).padStart(2, '0')

export function configColumns(c: AgentConfig): AgentConfigColumns {
  return {
    model: c.model,
    fallbackModel: c.fallbackModel,
    connectors: c.connectors,
    tools: c.tools,
    agents: c.agents,
    schedule: c.schedule,
    timezone: c.timezone,
    runsAs: c.runsAs,
    shareMode: c.share === 'none' ? 'none' : c.share === 'all' ? 'all' : 'rooms',
    shareRooms: Array.isArray(c.share) ? c.share : [],
    shareAs: c.shareAs,
    dryRun: c.dryRun,
    maxTurns: c.maxTurns,
    active: c.active,
    triggersJson: c.on,
    debounceMs: c.debounceMs,
    inputs: c.inputs.length ? c.inputs : null,
    inputValues: Object.keys(c.inputValues).length ? c.inputValues : null,
  }
}

export function runsForColumns(entries: RunsForEntry[]): RunsForColumns[] {
  return entries.map((e) => ({
    userId: e.userId,
    at: e.at ? `${pad(e.at.hour)}:${pad(e.at.minute)}` : null,
    timezone: e.timezone,
    model: e.model,
    inputs: Object.keys(e.inputs).length ? e.inputs : null,
  }))
}

/**
 * The record as a config. The stored values were validated on the way in;
 * they pass through the parsers again on every read anyway (via
 * `effectiveFrontmatter`), so a value a later rule refuses surfaces as the
 * agent's parse error rather than as a silent run.
 */
export function configFromColumns(row: AgentConfigColumns, subs: RunsForColumns[]): AgentConfig {
  const tr = row.triggersJson && typeof row.triggersJson === 'object' ? (row.triggersJson as Partial<AgentTriggers>) : null
  const on: AgentTriggers | null =
    tr && ((tr.context?.length ?? 0) > 0 || tr.webhook)
      ? { context: tr.context ?? [], webhook: tr.webhook ?? null, ...(tr.wake === 'always' ? { wake: 'always' as const } : {}) }
      : null
  return {
    model: row.model,
    fallbackModel: row.fallbackModel,
    connectors: row.connectors,
    tools: row.tools as AgentToolExtra[],
    agents: row.agents,
    share: row.shareMode === 'all' ? 'all' : row.shareMode === 'rooms' && row.shareRooms.length ? row.shareRooms : 'none',
    shareAs: row.shareAs === 'run-in' ? 'run-in' : 'use',
    dryRun: row.dryRun,
    maxTurns: row.maxTurns,
    runsFor: subs.map((s) => {
      const m = s.at ? /^(\d{1,2}):(\d{2})$/.exec(s.at) : null
      const inputs = parseInputValues(s.inputs)
      return {
        userId: s.userId,
        at: m ? { hour: Number(m[1]), minute: Number(m[2]) } : null,
        timezone: s.timezone,
        model: s.model,
        inputs: inputs.ok ? inputs.value : {},
      }
    }),
    inputs: storedInputs(row.inputs),
    inputValues: storedValues(row.inputValues),
    active: row.active,
    schedule: (row.schedule as AgentSchedule | null) ?? null,
    on,
    debounceMs: row.debounceMs,
    timezone: row.timezone,
    runsAs: row.runsAs,
  }
}

const storedInputs = (raw: unknown): AgentInput[] => {
  const r = parseAgentInputs(raw)
  return r.ok ? r.value : []
}

const storedValues = (raw: unknown): InputValues => {
  const r = parseInputValues(raw)
  return r.ok ? r.value : {}
}

/** JSON with object keys in one order — a JSONB column hands keys back in its own. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** The fields of `patch` that actually change `before` — what the audit row records. */
export function configDiff(before: AgentConfig, after: AgentConfig): Partial<AgentConfig> {
  const out: Partial<AgentConfig> = {}
  for (const k of Object.keys(after) as (keyof AgentConfig)[]) {
    if (stable(before[k]) !== stable(after[k])) (out as Record<string, unknown>)[k] = after[k]
  }
  return out
}
