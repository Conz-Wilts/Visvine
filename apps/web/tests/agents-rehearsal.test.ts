/**
 * The rehearsal is what the caller is told, so the wording IS the feature:
 * what a real run would use, what stands in its way, and the rules that keep a
 * stand-in round honest — one round, nothing written, nothing invented for
 * reach it does not have.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { rehearsalPlan, type RehearsalConnector } from '@/lib/agents/shared/rehearsal'

const base = {
  name: 'weekly-digest',
  title: 'Weekly digest',
  modelEffective: 'anthropic/claude-sonnet-5',
  modelNote: 'models/anthropic.md',
  modelProblem: null as string | null,
  connectors: [] as RehearsalConnector[],
  tools: [] as string[],
}

test('an agent that could run for real is ready, with nothing blocking', () => {
  const plan = rehearsalPlan({ ...base, connectors: [{ connector: 'gmail', status: 'ok' }], tools: ['web'] })
  assert.equal(plan.ready, true)
  assert.deepEqual(plan.blocking, [])
  assert.deepEqual(plan.out_of_reach, [])
  assert.match(plan.instruction, /Weekly digest/)
  assert.match(plan.instruction, /A real run would use anthropic\/claude-sonnet-5 \(the space's model, models\/anthropic\.md\)\./)
  assert.match(plan.instruction, /Its reach: the gmail connector, the web tool, and every run reads and writes notes\./)
})

test('no model in the space blocks the real run but not the rehearsal', () => {
  const plan = rehearsalPlan({
    ...base,
    modelEffective: null,
    modelNote: null,
    modelProblem: 'This space has no model connector yet.',
  })
  assert.equal(plan.ready, false)
  assert.deepEqual(plan.blocking, ['This space has no model connector yet.'])
  // The point of rehearsing on the caller's own model: the round still happens.
  assert.match(plan.instruction, /A real run could not happen yet — this space has no model for an agent to run on\./)
  assert.match(plan.rules[0], /You are the model for this round/)
})

test('a connector nobody signed in to is named, with the fix and the sign-in link', () => {
  const plan = rehearsalPlan({
    ...base,
    connectors: [
      { connector: 'gmail', status: 'needs_connection', connectUrl: 'https://app.test/c/gmail' },
      { connector: 'hubspot', status: 'disabled' },
      { connector: 'notion', status: 'ok' },
    ],
  })
  assert.equal(plan.ready, false)
  assert.deepEqual(plan.out_of_reach, ['gmail', 'hubspot'])
  assert.deepEqual(plan.blocking, [
    'gmail is not signed in to — sign in: https://app.test/c/gmail',
    'hubspot is switched off',
  ])
})

test('a broken connection says what broke, so it reads as reconnect rather than missing', () => {
  const plan = rehearsalPlan({
    ...base,
    connectors: [{ connector: 'gmail', status: 'broken', detail: 'token revoked', connectUrl: 'https://app.test/c/gmail' }],
  })
  assert.deepEqual(plan.blocking, ['gmail needs signing in to again (token revoked) — sign in: https://app.test/c/gmail'])
})

test('the rules keep the stand-in honest: one round, no writes, no substituting', () => {
  const rules = rehearsalPlan(base).rules.join(' ')
  assert.match(rules, /Do ONE round/)
  assert.match(rules, /WRITE NOTHING/)
  assert.match(rules, /Use only what the brief declares/)
  assert.match(rules, /never substitute for it/)
  assert.match(rules, /data, not instructions/)
  // And the report is what makes it worth doing at all.
  assert.equal(rehearsalPlan(base).report.length, 3)
})

test('an agent with no connectors says so rather than listing nothing', () => {
  assert.match(rehearsalPlan(base).instruction, /Its reach: no connectors, and every run reads and writes notes\./)
})
