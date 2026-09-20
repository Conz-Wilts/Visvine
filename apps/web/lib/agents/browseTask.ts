/**
 * A goal carried out in the machine's browser by the judge, a step at a time.
 *
 * The agent's own model is slow and paid for by the space; pressing through a
 * form is a dozen small decisions, each of which is "which of these rows".
 * That is a judge's question. So `browse_task` takes the goal and the values
 * to type from the model ONCE, and then loops without it: read the page as a
 * table, ask the judge which operation and which row (one request,
 * lib/agents/shared/pageTable.ts), do it on the machine, read again. The model
 * gets the page back at the end, with every step taken, and decides for itself
 * whether the goal was met — DONE here is a claim, never evidence.
 *
 * This is the one place a judge's answer CAUSES something, so what it can
 * cause is fenced by everything that already fences the machine, and by the
 * shape of the question:
 *
 *   - it picks a row of a table code built — never a selector, a URL or a
 *     string to type. The only text that reaches a field is an `inputs` value
 *     the model supplied; password fields are not rows at all;
 *   - the browser reaches only the hosts the brief's connectors name;
 *   - an unsure answer presses nothing: the page goes back to the model, which
 *     carries on with page_act;
 *   - it ends on its own: a step cap, a wall clock, and three actions in a row
 *     that changed nothing.
 *
 * No judge — no key, switched off, out of allowance — is an ordinary ending
 * (`no_judge`), and the model drives the same table itself.
 */
import { decide } from '@/lib/judge/client'
import { pageOnMachine } from '@/lib/vm/page'
import type { PageCommand, PageResult, PageState } from '@/lib/vm/shared/pageScript'
import { browseRequest, commandFor, readDecision, stalled, type BrowseStep } from './shared/pageTable'

export const BROWSE_MAX_STEPS = 40
const BROWSE_WALL_MS = 240_000
/** A page that moved under a decision is read again, this many times in a row, before giving up. */
const MAX_STALE = 4

export type BrowseStatus = 'done' | 'blocked' | 'needs_input' | 'unsure' | 'stalled' | 'budget' | 'no_judge' | 'no_page' | 'failed'

export interface BrowseOutcome {
  status: BrowseStatus
  /** Why it stopped, when the status alone does not say. */
  detail?: string
  steps: BrowseStep[]
  /** The page as it stood when the loop stopped; absent when it could not be read. */
  page?: PageState
  judgeCalls: number
  elapsedMs: number
}

export interface BrowseDeps {
  step: (command: PageCommand) => Promise<PageResult>
  decide: typeof decide
  now: () => number
}

export async function browseTask(
  input: { goal: string; inputs: Readonly<Record<string, string>> },
  deps: BrowseDeps,
): Promise<BrowseOutcome> {
  const started = deps.now()
  const steps: BrowseStep[] = []
  let judgeCalls = 0
  let page: PageState | undefined
  const end = (status: BrowseStatus, detail?: string): BrowseOutcome => ({ status, detail, steps, page, judgeCalls, elapsedMs: deps.now() - started })

  const first = await deps.step({})
  if (!first.ok) return end(first.reason === 'no_page' ? 'no_page' : 'failed', 'message' in first ? first.message : undefined)
  page = first.state

  let stale = 0
  while (steps.length < BROWSE_MAX_STEPS) {
    if (deps.now() - started > BROWSE_WALL_MS) return end('budget', 'out of time')
    const request = browseRequest(page, input.goal, input.inputs, steps)
    // One retry: a judge that does not answer twice is a judge that is not there.
    let answers = await deps.decide(request.state, request.questions, { deadlineMs: 5_000, bucket: 'browse', patient: true })
    judgeCalls += 1
    if (!answers) {
      answers = await deps.decide(request.state, request.questions, { deadlineMs: 5_000, bucket: 'browse', patient: true })
      judgeCalls += 1
    }
    if (!answers) return end('no_judge')

    const decision = readDecision(answers, request.table, input.inputs)
    if (decision.kind === 'end') return end(decision.status)
    if (decision.kind === 'unsure') return end('unsure', decision.why)

    const before: PageState = page
    const result = await deps.step(commandFor(before, decision.action, decision.text))
    if (!result.ok) {
      if (result.reason !== 'stale') return end('failed', result.message)
      // Nothing was pressed. Decide again over the page as it is now.
      page = result.state
      if (++stale > MAX_STALE) return end('stalled', 'the page keeps changing under each decision')
      continue
    }
    stale = 0
    page = result.state
    steps.push({
      operation: decision.operation,
      label: decision.action.label,
      ...(decision.text !== null ? { text: decision.text } : {}),
      page_changed: page.fingerprint !== before.fingerprint,
    })
    if (stalled(steps)) return end('stalled', 'three actions in a row changed nothing')
  }
  return end('budget', `${BROWSE_MAX_STEPS} steps`)
}

/** The loop over a real machine and the real judge. */
export function browseTaskOnMachine(
  spaceId: string,
  agentName: string,
  input: { goal: string; inputs: Readonly<Record<string, string>> },
  options: { taskAllow?: readonly string[]; runId?: string | null },
): Promise<BrowseOutcome> {
  return browseTask(input, {
    step: (command) => pageOnMachine(spaceId, agentName, { ...command, task: true }, options),
    decide,
    now: Date.now,
  })
}
