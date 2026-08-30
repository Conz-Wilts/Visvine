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
const MACHINE_TOOLS: ReadonlySet<string> = new Set(['run_command', 'open_page'])

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
  for (const event of ordered) {
    const opens = event.kind === 'exec' || event.kind === 'browse'
    if (opens) {
      if (opened) index = Math.min(index + 1, machineSteps.length - 1)
      opened = true
    }
    ;(machineSteps[index].machine ??= []).push(event)
  }
  return steps
}
