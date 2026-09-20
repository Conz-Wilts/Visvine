/**
 * The judge's browser loop and the table it decides over — pure, against a
 * scripted page and scripted answers. What is pinned: the judge picks rows and
 * never text; an unsure answer presses nothing; a moved page is decided again;
 * and the loop always ends.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { browseTask, BROWSE_MAX_STEPS, type BrowseDeps } from '@/lib/agents/browseTask'
import { browseRequest, pageTable, readDecision } from '@/lib/agents/shared/pageTable'
import type { JudgeAnswers } from '@/lib/judge/shared/types'
import { PAGE_SCRIPT, type PageCommand, type PageResult, type PageState } from '@/lib/vm/shared/pageScript'
import { parsePageResult } from '@/lib/vm/page'

const page = (fingerprint: string, over: Partial<PageState> = {}): PageState => ({
  url: 'https://stays.example.com/',
  title: 'Stays',
  text: 'Find a stay',
  scroll: { y: 0, height: 780 },
  actions: [
    { id: 'e1', kind: 'fill', node: 1, role: 'textbox', label: 'City', value: '' },
    { id: 'e2', kind: 'fill', node: 2, role: 'textbox', label: 'Guest', value: '' },
    { id: 'e3', kind: 'select', node: 3, role: 'combobox', label: 'Style → Design', value: 'design', current_value: 'Any' },
    { id: 'e4', kind: 'click', node: 4, role: 'button', label: 'Search' },
    { id: 'wait', kind: 'wait', label: 'Wait for the page to update' },
  ],
  guards: { '1': 'a', '2': 'b', '3': 'c', '4': 'd' },
  fingerprint,
  omitted: 0,
  ...over,
})

const pick = (choice: string, p = 0.9) => ({ type: 'choice' as const, choice, probabilities: { [choice]: p }, confidence: p })
const answer = (operation: string, heads: Record<string, string> = {}, p = 0.9): JudgeAnswers => ({
  operation: pick(operation, p),
  ...Object.fromEntries(Object.entries(heads).map(([k, v]) => [k, pick(v)])),
})

function harness(answers: (JudgeAnswers | null)[], pages: (PageResult | ((c: PageCommand) => PageResult))[]) {
  const commands: PageCommand[] = []
  const asked: ReturnType<typeof browseRequest>[] = []
  let clock = 0
  const deps: BrowseDeps = {
    step: async (command) => {
      commands.push(command)
      const next = pages.shift()
      assert.ok(next, 'a page for every step')
      return typeof next === 'function' ? next(command) : next
    },
    decide: (async (state: unknown, questions: unknown) => {
      asked.push({ state, questions } as never)
      return answers.length ? answers.shift()! : answer('DONE')
    }) as BrowseDeps['decide'],
    now: () => (clock += 1_000),
  }
  return { deps, commands, asked }
}
const ok = (state: PageState): PageResult => ({ ok: true, acted: true, state })

test('the table: one row per element, a field is also pressable, options hang off their dropdown', () => {
  const t = pageTable(page('x').actions)
  assert.deepEqual(t.elements.map((e) => [e.index, e.label, e.operations]), [
    ['1', 'City', ['TYPE_TEXT', 'CLICK']],
    ['2', 'Guest', ['TYPE_TEXT', 'CLICK']],
    ['3', 'Style', ['SELECT']],
    ['4', 'Search', ['CLICK']],
  ])
  assert.equal(t.targets.SELECT?.['3:1'].value, 'design')
  assert.equal(t.targets.CLICK?.['1'].kind, 'click')
  assert.deepEqual(Object.keys(t.controls), ['WAIT'])
})

test('the request: typing is offered only when there is something to type, and the value head only when there is a choice', () => {
  const none = browseRequest(page('x'), 'g', {}, [])
  assert.ok(!('TYPE_TEXT' in (none.questions.operation as { criteria: object }).criteria))
  assert.ok(!none.questions.type_text_target && !none.questions.type_text_value)
  assert.ok('NEED_INPUT' in (none.questions.operation as { criteria: object }).criteria)
  const one = browseRequest(page('x'), 'g', { city: 'Lisbon' }, [])
  assert.ok(one.questions.type_text_target && !one.questions.type_text_value)
  const two = browseRequest(page('x'), 'g', { city: 'Lisbon', guest: 'Ana' }, [])
  assert.deepEqual(Object.keys((two.questions.type_text_value as { criteria: object }).criteria), ['city', 'guest'])
})

test('a decision is a row and a supplied value, or nothing: a weak head, a missing row or an unknown value presses nothing', () => {
  const inputs = { city: 'Lisbon', guest: 'Ana' }
  const { table } = browseRequest(page('x'), 'g', inputs, [])
  const typed = readDecision(answer('TYPE_TEXT', { type_text_target: '2', type_text_value: 'guest' }), table, inputs)
  assert.ok(typed.kind === 'act' && typed.action.node === 2 && typed.text === 'Ana')
  assert.equal(readDecision(answer('CLICK', { click_target: '4' }, 0.3), table, inputs).kind, 'unsure')
  assert.equal(readDecision(answer('CLICK'), table, inputs).kind, 'unsure')
  assert.equal(readDecision(answer('CLICK', { click_target: '44' }), table, inputs).kind, 'unsure')
  assert.equal(readDecision(answer('TYPE_TEXT', { type_text_target: '1', type_text_value: 'password' }), table, inputs).kind, 'unsure')
  // An unused head causes nothing: the operation names the head that is read.
  const waited = readDecision(answer('WAIT', { click_target: '4' }), table, inputs)
  assert.ok(waited.kind === 'act' && waited.action.kind === 'wait')
  assert.deepEqual(readDecision(answer('NEED_INPUT'), table, inputs), { kind: 'end', status: 'needs_input' })
})

test('the loop: type, select, press, done — each action carrying the guard of the page it was decided on', async () => {
  const h = harness(
    [
      answer('TYPE_TEXT', { type_text_target: '1' }),
      answer('SELECT', { select_target: '3:1' }),
      answer('CLICK', { click_target: '4' }),
      answer('DONE'),
    ],
    [ok(page('p0')), ok(page('p1')), ok(page('p2')), ok(page('p3', { title: 'Results' }))],
  )
  const out = await browseTask({ goal: 'Search Lisbon, Design', inputs: { city: 'Lisbon' } }, h.deps)
  assert.equal(out.status, 'done')
  assert.deepEqual(out.steps.map((s) => [s.operation, s.label, s.text, s.page_changed]), [
    ['TYPE_TEXT', 'City', 'Lisbon', true],
    ['SELECT', 'Style → Design', undefined, true],
    ['CLICK', 'Search', undefined, true],
  ])
  assert.deepEqual(h.commands.map((c) => c.act && [c.act.kind, c.act.node, c.act.guard, c.act.text ?? c.act.value]), [
    undefined,
    ['fill', 1, 'a', 'Lisbon'],
    ['select', 3, 'c', 'design'],
    ['click', 4, 'd', undefined],
  ])
  assert.equal(out.page?.title, 'Results')
  assert.equal((h.asked[2].state as { recent_actions: unknown[] }).recent_actions.length, 2, 'the judge sees what was already done')
})

test('a moved page is decided again, not pressed; an unsure judge and an absent one hand the page back', async () => {
  const moved = harness(
    [answer('CLICK', { click_target: '4' }), answer('CLICK', { click_target: '4' }), answer('DONE')],
    [ok(page('p0')), { ok: false, reason: 'stale', state: page('p0b', { guards: { '1': 'a', '2': 'b', '3': 'c', '4': 'd2' } }) }, ok(page('p1'))],
  )
  const out = await browseTask({ goal: 'g', inputs: {} }, moved.deps)
  assert.equal(out.status, 'done')
  assert.equal(out.steps.length, 1, 'the stale attempt is not a step')
  assert.equal(moved.commands[2].act?.guard, 'd2', 'the second attempt presents the new page\'s guard')

  const unsure = harness([answer('CLICK', { click_target: '4' }, 0.2)], [ok(page('p0'))])
  assert.equal((await browseTask({ goal: 'g', inputs: {} }, unsure.deps)).status, 'unsure')
  assert.equal(unsure.commands.length, 1, 'nothing was pressed')

  const absent = harness([null, null], [ok(page('p0'))])
  const gone = await browseTask({ goal: 'g', inputs: {} }, absent.deps)
  assert.equal(gone.status, 'no_judge')
  assert.equal(gone.judgeCalls, 2, 'asked twice, then handed back')
  assert.ok(gone.page, 'with the page, so the model carries on')

  const closed = harness([], [{ ok: false, reason: 'no_page', message: 'open_page first' }])
  assert.equal((await browseTask({ goal: 'g', inputs: {} }, closed.deps)).status, 'no_page')
})

test('the loop always ends: three actions that change nothing, and a step cap', async () => {
  const same = page('same')
  const wall = harness(Array.from({ length: 5 }, () => answer('CLICK', { click_target: '4' })), [ok(same), ok(same), ok(same), ok(same)])
  const stuck = await browseTask({ goal: 'g', inputs: {} }, wall.deps)
  assert.equal(stuck.status, 'stalled')
  assert.equal(stuck.steps.length, 3)

  let n = 0
  const forever = harness(
    Array.from({ length: BROWSE_MAX_STEPS + 5 }, () => answer('CLICK', { click_target: '4' })),
    Array.from({ length: BROWSE_MAX_STEPS + 5 }, () => () => ok(page(`p${n++}`))),
  )
  // The harness clock ticks a second a call, so time runs out before the step cap; either bound ends it.
  const capped = await browseTask({ goal: 'g', inputs: {} }, forever.deps)
  assert.equal(capped.status, 'budget')
  assert.ok(capped.steps.length <= BROWSE_MAX_STEPS)
})

test('the machine script: never lists or fills a credential, and its last line is the result', () => {
  assert.match(PAGE_SCRIPT, /'password', 'file', 'hidden'/)
  assert.ok(!/eval\(|new Function/.test(PAGE_SCRIPT), 'nothing a caller sends is evaluated as code')
  assert.deepEqual(parsePageResult('noise\n{"ok":false,"reason":"no_page","message":"m"}\n', '', 0), { ok: false, reason: 'no_page', message: 'm' })
  const broken = parsePageResult('', 'boom', 1)
  assert.ok(!broken.ok && broken.reason === 'failed' && /boom/.test(broken.message))
})
