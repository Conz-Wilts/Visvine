/**
 * A run's trace as STEPS — the shape a person reads, folded from two flat
 * logs that are written by two different machines.
 *
 * The executor (lib/agents/runner.ts) flushes `AgentRunEvent`s: the model's
 * text, each tool call and its result. The agent's machine (apps/agent-edge)
 * reports `AgentVmEvent`s: what it booted, ran, printed and was refused. They
 * are one story told twice, and `runId` is the join: a `run_command` step in
 * the first log is the `exec` / `output` / `exit` events in the second, so the
 * window nests the terminal under the step that asked for it rather than
 * showing two timelines side by side and leaving the reader to line them up.
 *
 * Pure and shared: the window renders it live and after the fact, and the
 * test fixes the fold so a reordered flush cannot silently detach output from
 * its command.
 */
import { isPageInstall, isTaskPageCommand } from '@/lib/vm/shared/pageScript'
import type { AgentRunEvent } from '../runs'

export interface Step {
  kind: 'tool' | 'thought' | 'note'
  at: number
  /** The tool name for a tool step. */
  tool?: string
  /** What the call was about (path, query, command…). */
  detail?: string
  /** The tool's result; undefined while it is still running. */
  result?: string
  /** When the result arrived. */
  endedAt?: number
  /** A thought's or note's text. */
  text?: string
  /** The machine's own record of this step — its command, output and exit. */
  machine?: MachineEvent[]
}

/** One event off the machine's timeline, as the API serializes it. */
export interface MachineEvent {
  seq: number
  kind: string
  at: string
  payload: Record<string, unknown>
}

/** The run tools that drive the agent's machine; their steps carry `machine`. */
const MACHINE_TOOLS: ReadonlySet<string> = new Set(['run_command', 'open_page', 'page_snapshot', 'page_act', 'browse_task'])

/** Fold the flat trace into steps: a tool event opens one, its result closes it. */
export function stepsOf(events: AgentRunEvent[]): Step[] {
  const steps: Step[] = []
  let open: Step | null = null
  for (const e of events) {
    if (e.type === 'tool') {
      open = { kind: 'tool', at: e.at, tool: e.tool, detail: e.detail }
      steps.push(open)
    } else if (e.type === 'tool_result') {
      if (open && open.tool === e.tool && open.result === undefined) {
        open.result = e.text
        open.endedAt = e.at
      } else {
        steps.push({ kind: 'tool', at: e.at, tool: e.tool, detail: '', result: e.text, endedAt: e.at })
      }
      open = null
    } else if (e.type === 'assistant') {
      steps.push({ kind: 'thought', at: e.at, text: e.text })
      open = null
    } else {
      steps.push({ kind: 'note', at: e.at, text: e.text })
    }
  }
  return steps
}

/**
 * Hand each machine event to the step that caused it.
 *
 * A machine step's window is [at, endedAt] — or open-ended while it runs — and
 * the machine's clock is its own, so the match is by ORDER rather than by
 * timestamp: events are walked in `seq` order and each one belongs to the
 * earliest machine step not yet closed by a later `exec`. Events before the
 * first machine step (a boot the lease caused) ride the first step; events
 * after the last one stay with the last, which is where a sleep or a late
 * refusal reads best. Nothing is dropped.
 */
export function attachMachine(steps: Step[], events: MachineEvent[]): Step[] {
  const machineSteps = steps.filter((s) => s.kind === 'tool' && s.tool && MACHINE_TOOLS.has(s.tool))
  if (machineSteps.length === 0 || events.length === 0) return steps
  const ordered = [...events].sort((a, b) => a.seq - b.seq)
  // An `exec` (or a browse) opens the next machine step — unless the current
  // step has not had its own yet, in which case this is it. Everything else
  // joins whichever step is open.
  let index = 0
  let opened = false
  let retried = false
  for (const event of ordered) {
    // A browse_task is one step made of many commands: once it has its first,
    // the rest of its loop stays with it. And the first page command of a wake
    // is three — the try, the script being installed, the retry — for one step.
    const cmd = event.payload.cmd
    const install = isPageInstall(cmd)
    const continues = opened && (install || retried || (machineSteps[index].tool === 'browse_task' && isTaskPageCommand(cmd)))
    if (event.kind === 'exec') retried = install
    const opens = !continues && (event.kind === 'exec' || event.kind === 'browse')
    if (opens) {
      if (opened) index = Math.min(index + 1, machineSteps.length - 1)
      opened = true
    }
    ;(machineSteps[index].machine ??= []).push(event)
  }
  return steps
}

/** The verb a tool reads as, and the noun a count of its calls takes. */
export const TOOL_VERB: Readonly<Record<string, { verb: string; one: string; many: string }>> = {
  list_context: { verb: 'Listed', one: 'folder', many: 'folders' },
  search_context: { verb: 'Searched', one: 'time', many: 'times' },
  read_context: { verb: 'Read', one: 'note', many: 'notes' },
  write_context: { verb: 'Wrote', one: 'note', many: 'notes' },
  append_context: { verb: 'Appended to', one: 'note', many: 'notes' },
  run_connector: { verb: 'Called', one: 'connector', many: 'connectors' },
  fetch_url: { verb: 'Fetched', one: 'page', many: 'pages' },
  run_command: { verb: 'Ran', one: 'command', many: 'commands' },
  open_page: { verb: 'Opened', one: 'page', many: 'pages' },
  page_snapshot: { verb: 'Read', one: 'page', many: 'pages' },
  page_act: { verb: 'Pressed', one: 'control', many: 'controls' },
  browse_task: { verb: 'Browsed', one: 'goal', many: 'goals' },
  decide: { verb: 'Judged', one: 'list', many: 'lists' },
  run_agent: { verb: 'Started', one: 'agent', many: 'agents' },
  create_node: { verb: 'Created', one: 'record', many: 'records' },
  link_nodes: { verb: 'Linked', one: 'record', many: 'records' },
}

/** A result that begins with "error" is a refusal the model had to work around. */
export function stepFailed(step: Step): boolean {
  return step.kind === 'tool' && typeof step.result === 'string' && /^error\b/i.test(step.result.trimStart())
}

/**
 * One thing the run set out to do: what the model said it was about to do, and
 * the tool calls it then made. The page lists groups; a group opens onto its
 * subtasks.
 */
export interface StepGroup {
  title: string
  /** Everything the model said at the head of this group; shown once it is open. */
  text: string | null
  /** The executor's asides that fell inside this group. */
  notes: string[]
  subtasks: Step[]
  state: 'running' | 'failed' | 'done'
  at: number
  endedAt: number | null
}

const TITLE_MAX = 64

/** The openers a model puts before the thing it is actually about to do. */
const LEAD_IN = /^(?:(?:ok(?:ay)?|now|first|next|then|great|alright|finally)[,:.!]?\s+)*(?:i(?:'|’)ll|i will|i(?:'|’)m going to|i am going to|let me|let(?:'|’)s|i need to|i(?:'|’)ll now|now i(?:'|’)ll)\s+/i

/** A thought's first sentence as a title: no lead-in, no markdown, one line, clipped. */
export function titleOfThought(text: string): string {
  const line = text
    .split('\n')
    .map((l) => l.replace(/^[#>*\-\s]+/, '').trim())
    .find((l) => l.length > 0)
  if (!line) return ''
  const sentence = (/^(.+?[.!?:])(?:\s|$)/.exec(line)?.[1] ?? line).replace(/[.:!]+$/, '')
  const bare = sentence.replace(LEAD_IN, '').replace(/[*_`]/g, '').trim()
  if (!bare) return ''
  const titled = bare[0].toUpperCase() + bare.slice(1)
  return titled.length > TITLE_MAX ? `${titled.slice(0, TITLE_MAX - 1).trimEnd()}…` : titled
}

/** A title made of the calls alone: "Read people/ana/index.md", "Fetched 6 pages", "Read 2 notes · Wrote 1 note". */
function titleOfSubtasks(subtasks: Step[]): string {
  if (subtasks.length === 1 && subtasks[0].detail) {
    return `${TOOL_VERB[subtasks[0].tool ?? '']?.verb ?? subtasks[0].tool ?? 'Did'} ${subtasks[0].detail}`
  }
  const counts = new Map<string, number>()
  for (const s of subtasks) counts.set(s.tool ?? '', (counts.get(s.tool ?? '') ?? 0) + 1)
  return [...counts]
    .slice(0, 2)
    .map(([tool, n]) => {
      const v = TOOL_VERB[tool]
      return v ? `${v.verb} ${n} ${n === 1 ? v.one : v.many}` : `${tool || 'Worked'}${n > 1 ? ` × ${n}` : ''}`
    })
    .join(' · ')
}

/**
 * Fold steps into groups by TURN: a thought opens a group and the tool calls
 * that follow are its subtasks, until the model speaks again. Calls made before
 * it said anything form a leading group; the executor's notes join the group
 * they fell in (the first one, when they came before any). Nothing is dropped.
 */
export function groupSteps(steps: Step[]): StepGroup[] {
  type Draft = { text: string | null; notes: string[]; subtasks: Step[]; at: number }
  const drafts: Draft[] = []
  let current: Draft | null = null
  let early: string[] = []
  const open = (at: number, text: string | null): Draft => {
    const d: Draft = { text, notes: early, subtasks: [], at }
    early = []
    drafts.push(d)
    return d
  }
  for (const step of steps) {
    if (step.kind === 'thought') current = open(step.at, step.text ?? '')
    else if (step.kind === 'tool') (current ??= open(step.at, null)).subtasks.push(step)
    else if (current) current.notes.push(step.text ?? '')
    else early.push(step.text ?? '')
  }
  if (early.length > 0) open(steps[0]?.at ?? 0, null)

  return drafts.map((d) => {
    const last = d.subtasks[d.subtasks.length - 1]
    const running = d.subtasks.some((s) => s.result === undefined)
    return {
      title: (d.text ? titleOfThought(d.text) : '') || titleOfSubtasks(d.subtasks) || d.notes[0] || 'Thought',
      text: d.text && d.text.trim() ? d.text.trim() : null,
      notes: d.notes,
      subtasks: d.subtasks,
      state: running ? 'running' : d.subtasks.some(stepFailed) ? 'failed' : 'done',
      at: d.at,
      endedAt: running ? null : (last?.endedAt ?? d.at),
    }
  })
}
