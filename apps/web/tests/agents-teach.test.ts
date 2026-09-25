// Turning a demonstration into a skill. The load-bearing test here is the
// first one: a takeover exists so a person can type a password where the model
// cannot see it, so neither the trace nor the skill may ever carry what was
// typed.
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/agents-teach.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { coerceDraft, describeTrace, renderSkill, type Demonstration } from '@/lib/agents/teach'
import { parseKeywords, parseSkill } from '@/lib/agents/shared/skills'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'

const SECRET = 'hunter2-the-actual-password'

const demo: Demonstration = {
  folder: 'agents/digest',
  agent: 'digest',
  by: 'Connor',
  heldMs: 42_000,
  steps: [
    { at: '2026-08-29T12:00:00.000Z', kind: 'click', where: 'Sign in — Acme', x: 640, y: 300 },
    // The machine recorded that typing happened and how much. Never the text.
    { at: '2026-08-29T12:00:04.000Z', kind: 'type', where: 'Sign in — Acme', typedChars: SECRET.length },
    { at: '2026-08-29T12:00:06.000Z', kind: 'key', where: 'Sign in — Acme', key: 'Return' },
    { at: '2026-08-29T12:00:12.000Z', kind: 'click', where: 'Expenses — Acme', x: 120, y: 80 },
  ],
  touched: ['/workspace/expenses/march.csv'],
  runId: 'run_7',
}

test('what the model is shown says that typing happened, never what was typed', () => {
  const trace = describeTrace(demo)
  assert.ok(!trace.includes(SECRET))
  assert.match(trace, /typed 27 characters on "Sign in — Acme"/)
  assert.match(trace, /pressed Return/)
  assert.match(trace, /\/workspace\/expenses\/march\.csv/)
})

test('the skill the trace produces carries no secret either', () => {
  const draft = coerceDraft(
    JSON.stringify({
      title: 'File the March expenses',
      description: 'Sign in to Acme and upload the month’s receipts',
      keywords: ['expense report', 'acme expenses'],
      steps: '1. Sign in to Acme.\n2. Enter the password for the shared account.\n3. Upload the CSV.',
      uncertain: ['Which account was signed in to'],
    }),
  )
  assert.ok(draft)
  const skill = renderSkill(demo, draft!, 'pending')
  assert.ok(!skill.index.includes(SECRET))
  assert.ok(!skill.steps.includes(SECRET))
  assert.equal(skill.slug, 'file-the-march-expenses')
  assert.equal(skill.indexPath, 'agents/digest/skills/file-the-march-expenses/index.md')

  // It is a real skill note: it parses back, as pending, with its keywords.
  const parsed = parseSkill(skill.indexPath, parseFrontmatter(skill.index))
  assert.equal(parsed?.status, 'pending')
  assert.equal(parsed?.title, 'File the March expenses')
  assert.deepEqual(parsed?.keywords[0], { all: ['expense', 'report'], score: 2 })
  assert.equal(parsed?.taughtBy, 'Connor')
  assert.equal(parsed?.taughtInRun, 'run_7')

  // Reach starts empty: an approver should see a claim the agent made, not one
  // we guessed on its behalf.
  assert.deepEqual([...(parsed?.hosts ?? [])], [])
  assert.deepEqual([...(parsed?.actions ?? [])], [])

  // What it could not tell is written down rather than invented over.
  assert.match(skill.index, /What I am not sure about/)
})

test('a draft nobody can read is refused rather than guessed at', () => {
  assert.equal(coerceDraft(''), null)
  assert.equal(coerceDraft('I am sorry, I cannot do that.'), null)
  assert.equal(coerceDraft('{ not json at all'), null)
  // A title is the one thing a skill cannot be without.
  assert.equal(coerceDraft(JSON.stringify({ description: 'no title here' })), null)

  // Fenced JSON is the ordinary case and must work.
  const fenced = coerceDraft('```json\n{"title":"Do the thing","steps":"1. Do it."}\n```')
  assert.equal(fenced?.title, 'Do the thing')
  assert.deepEqual(fenced?.keywords, [])
})

test('keywords need every word of a phrase, and weight by how specific it is', () => {
  assert.deepEqual(parseKeywords(['expense report', 'receipt']), [
    { all: ['expense', 'report'], score: 2 },
    { all: ['receipt'], score: 1 },
  ])
  assert.deepEqual(parseKeywords(['', '   ', 42, null]), [])
  assert.deepEqual(parseKeywords('not a list'), [])
})

test('a demonstration with no steps produces nothing to review', () => {
  assert.equal(describeTrace({ ...demo, steps: [], touched: [] }).trim(), '')
})
