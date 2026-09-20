/**
 * A page as a numbered table, and the typed decision made over it. Pure.
 *
 * The machine reports a page as actions (lib/vm/shared/pageScript.ts). Two
 * readers take it from here, and both see the same table:
 *
 *   the agent's own model   `renderPage` → text for `page_snapshot`, and
 *                           `actionFor` resolves the index it answers with;
 *   the judge               `browseRequest` → one request whose questions are
 *                           which OPERATION, which TARGET for each operation
 *                           that has one, and which supplied INPUT to type —
 *                           and `readDecision` turns the answers into one
 *                           action, or a reason to hand the page back.
 *
 * Either way the answer is an index into a table code built, never a selector
 * or a string to type that a judge invented: the judge cannot write, so the
 * only text that reaches a field is a value the calling model supplied.
 */
import type { ChoiceAnswer, JudgeAnswers, JudgeQuestions, JudgeState } from '@/lib/judge/shared/types'
import { choiceOf } from '@/lib/judge/shared/types'
import {
  BROWSE_OPERATIONS,
  BROWSE_OPERATION_FLOOR,
  BROWSE_TARGET_FLOOR,
  browseOperationQuestion,
  browseTargetQuestion,
  browseValueQuestion,
} from '@/lib/judge/shared/questions'
import type { PageAction, PageCommand, PageState } from '@/lib/vm/shared/pageScript'

type TargetOperation = 'CLICK' | 'TYPE_TEXT' | 'SELECT'
const OPERATION_OF: Partial<Record<PageAction['kind'], TargetOperation>> = { click: 'CLICK', fill: 'TYPE_TEXT', select: 'SELECT' }

interface PageElement {
  index: string
  role: string
  label: string
  value?: string
  checked?: string
  selected?: string
  expanded?: string
  operations: TargetOperation[]
  options?: { index: string; label: string }[]
}

export interface PageTable {
  elements: PageElement[]
  /** operation → target index (`3`, or `3:2` for a dropdown's option) → the action. */
  targets: Partial<Record<TargetOperation, Record<string, PageAction>>>
  /** ENTER, SCROLL_DOWN, SCROLL_UP, WAIT — the page-level actions on offer. */
  controls: Record<string, PageAction>
}

/** One row per observed element, however many actions it offers. */
export function pageTable(actions: readonly PageAction[]): PageTable {
  const elements: PageElement[] = []
  const indexOf = new Map<number, string>()
  const targets: PageTable['targets'] = {}
  const controls: PageTable['controls'] = {}
  for (const action of actions) {
    const operation = OPERATION_OF[action.kind]
    if (!operation || action.node === undefined) {
      controls[action.id.toUpperCase()] = action
      continue
    }
    let index = indexOf.get(action.node)
    if (!index) {
      index = String(elements.length + 1)
      indexOf.set(action.node, index)
      const element: PageElement = { index, role: action.role ?? '', label: action.label.split(' → ')[0], operations: [] }
      if (action.kind === 'select') element.value = action.current_value ?? ''
      else if (action.value) element.value = action.value
      for (const key of ['checked', 'selected', 'expanded'] as const) if (action[key] !== undefined) element[key] = action[key]
      elements.push(element)
    }
    const element = elements[Number(index) - 1]
    if (!element.operations.includes(operation)) element.operations.push(operation)
    let target = index
    if (action.kind === 'select') {
      element.options ??= []
      target = `${index}:${element.options.length + 1}`
      element.options.push({ index: target, label: action.label.split(' → ')[1] ?? action.label })
    }
    ;(targets[operation] ??= {})[target] = action
    // A field is pressed as well as typed into: a date picker opens on the click.
    if (action.kind === 'fill') {
      if (!element.operations.includes('CLICK')) element.operations.push('CLICK')
      ;(targets.CLICK ??= {})[index] = { ...action, kind: 'click' }
    }
  }
  return { elements, targets, controls }
}

const describeElement = (e: PageElement): string =>
  [
    `[${e.index}] ${e.role} "${e.label}"`,
    e.value !== undefined && e.value !== '' ? `value "${e.value}"` : e.operations.includes('TYPE_TEXT') ? 'empty' : null,
    e.checked !== undefined ? `checked=${e.checked}` : null,
    e.selected !== undefined ? `selected=${e.selected}` : null,
    e.expanded !== undefined ? `expanded=${e.expanded}` : null,
  ]
    .filter(Boolean)
    .join(' ')

/** The page as the agent's model reads it. */
export function renderPage(state: PageState): string {
  const { elements, controls } = pageTable(state.actions)
  const rows = elements.map((e) => {
    const line = `${describeElement(e)} — ${e.operations.map((o) => (o === 'TYPE_TEXT' ? 'fill' : o.toLowerCase())).join(', ')}`
    return e.options?.length ? `${line}\n${e.options.map((o) => `      [${o.index}] ${o.label}`).join('\n')}` : line
  })
  const pageLevel = Object.values(controls).map((c) => c.id)
  return [
    `${state.title || '(untitled)'} — ${state.url}`,
    `scrolled ${state.scroll.y} of ${state.scroll.height}px`,
    '',
    rows.length ? rows.join('\n') : '(no controls in view)',
    state.omitted ? `… ${state.omitted} more controls not listed` : null,
    `page: ${pageLevel.join(', ')}`,
    '',
    'Visible text:',
    state.text || '(none)',
  ]
    .filter((l) => l !== null)
    .join('\n')
}

/**
 * The action a caller named: an element index (`3`), a dropdown option
 * (`3:2`), or a page-level id (`scroll_down`, `enter`, `wait`). An error
 * string when the table has no such row, or the row does not offer `text`.
 */
export function actionFor(state: PageState, target: string, text: string | null): PageAction | string {
  const { targets, controls } = pageTable(state.actions)
  const named = target.trim().replace(/^\[|\]$/g, '')
  const control = controls[named.toUpperCase()]
  if (control) return control
  if (named.includes(':')) return targets.SELECT?.[named] ?? `error: no option ${named} on this page — take a page_snapshot`
  if (text !== null) return targets.TYPE_TEXT?.[named] ?? `error: [${named}] is not a field that takes text on this page`
  return targets.CLICK?.[named] ?? `error: no element ${named} on this page — take a page_snapshot`
}

/** What the machine is told to do for an action chosen off `state`. */
export function commandFor(state: PageState, action: PageAction, text: string | null): PageCommand {
  return {
    act: {
      kind: action.kind,
      node: action.node,
      guard: action.node === undefined ? undefined : state.guards[String(action.node)],
      value: action.kind === 'select' ? action.value : undefined,
      text: action.kind === 'fill' ? (text ?? '') : undefined,
      delta: action.delta,
    },
  }
}

// ── The judge's turn ────────────────────────────────────────────────────────

export interface BrowseStep {
  operation: string
  label: string
  text?: string
  page_changed: boolean | null
}

const STATE_TEXT_CHARS = 3_500
const STATE_ELEMENTS = 120

/** One request: the page, the goal, what has been done, and a question per head. */
export function browseRequest(
  state: PageState,
  goal: string,
  inputs: Readonly<Record<string, string>>,
  history: readonly BrowseStep[],
): { state: JudgeState; questions: JudgeQuestions; table: PageTable } {
  const table = pageTable(state.actions)
  const inputKeys = Object.keys(inputs)
  const offered: Record<string, string> = {}
  for (const op of ['CLICK', 'TYPE_TEXT', 'SELECT'] as const) {
    if (!table.targets[op]) continue
    // Typing is on offer only when there is something to type: the judge cannot write.
    if (op === 'TYPE_TEXT' && inputKeys.length === 0) continue
    offered[op] = BROWSE_OPERATIONS[op]
  }
  for (const [key, control] of Object.entries(table.controls)) offered[key] = control.label
  offered.NEED_INPUT = BROWSE_OPERATIONS.NEED_INPUT
  offered.DONE = BROWSE_OPERATIONS.DONE
  offered.BLOCKED = BROWSE_OPERATIONS.BLOCKED

  const elements = table.elements.slice(0, STATE_ELEMENTS)
  const listed = new Set(elements.map((e) => e.index))
  const questions: JudgeQuestions = { operation: browseOperationQuestion(goal, offered) }
  for (const op of ['CLICK', 'TYPE_TEXT', 'SELECT'] as const) {
    if (!offered[op]) continue
    const criteria: Record<string, string> = {}
    for (const [target, action] of Object.entries(table.targets[op] ?? {})) {
      const element = table.elements[Number(target.split(':')[0]) - 1]
      if (!listed.has(element.index)) continue
      criteria[target] = op === 'SELECT' ? `[${target}] ${action.label} (now "${action.current_value ?? ''}")` : describeElement(element)
    }
    if (Object.keys(criteria).length) questions[`${op.toLowerCase()}_target`] = browseTargetQuestion(goal, op, criteria)
  }
  if (offered.TYPE_TEXT && inputKeys.length > 1) {
    questions.type_text_value = browseValueQuestion(goal, Object.fromEntries(inputKeys.map((k) => [k, `${k}: "${inputs[k].slice(0, 120)}"`])))
  }
  return {
    state: {
      page: { url: state.url, title: state.title, text: state.text.slice(0, STATE_TEXT_CHARS) },
      elements,
      supplied_inputs: inputs,
      recent_actions: history.slice(-10),
    },
    questions,
    table,
  }
}

export type BrowseDecision =
  | { kind: 'act'; operation: string; action: PageAction; text: string | null; confidence: number }
  | { kind: 'end'; status: 'done' | 'blocked' | 'needs_input' }
  /** The judge answered, but not firmly enough to press anything on its word. */
  | { kind: 'unsure'; why: string }

const firm = (answer: ChoiceAnswer | undefined, floor: number): answer is ChoiceAnswer =>
  !!answer && (answer.probabilities[answer.choice] ?? 0) >= floor

export function readDecision(
  answers: JudgeAnswers,
  table: PageTable,
  inputs: Readonly<Record<string, string>>,
): BrowseDecision {
  const operation = choiceOf(answers, 'operation')
  if (!firm(operation, BROWSE_OPERATION_FLOOR)) return { kind: 'unsure', why: 'no clear next operation' }
  const op = operation.choice
  if (op === 'DONE') return { kind: 'end', status: 'done' }
  if (op === 'BLOCKED') return { kind: 'end', status: 'blocked' }
  if (op === 'NEED_INPUT') return { kind: 'end', status: 'needs_input' }
  const confidence = operation.probabilities[op] ?? 0
  const control = table.controls[op]
  if (control) return { kind: 'act', operation: op, action: control, text: null, confidence }
  const candidates = table.targets[op as TargetOperation]
  const target = choiceOf(answers, `${op.toLowerCase()}_target`)
  if (!candidates || !firm(target, BROWSE_TARGET_FLOOR)) return { kind: 'unsure', why: `no clear target to ${op.toLowerCase()}` }
  const action = candidates[target.choice]
  if (!action) return { kind: 'unsure', why: 'the chosen target is not on the page' }
  if (op !== 'TYPE_TEXT') return { kind: 'act', operation: op, action, text: null, confidence }
  const keys = Object.keys(inputs)
  const value = keys.length === 1 ? keys[0] : choiceOf(answers, 'type_text_value')
  const key = typeof value === 'string' ? value : firm(value, BROWSE_TARGET_FLOOR) ? value.choice : null
  if (!key || !(key in inputs)) return { kind: 'unsure', why: `no clear value for "${action.label}"` }
  return { kind: 'act', operation: op, action, text: inputs[key], confidence }
}

/** Three real actions in a row that changed nothing: it is pressing a wall. */
export function stalled(history: readonly BrowseStep[]): boolean {
  const last = history.slice(-3)
  return last.length === 3 && last.every((h) => h.page_changed === false && h.operation !== 'WAIT')
}
