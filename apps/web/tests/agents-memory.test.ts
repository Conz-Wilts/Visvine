import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyMemory, memoryForPrompt, memorySectionOf, rememberInto, setLastRun } from '../lib/agents/shared/memory'

test('an empty memory has the four sections and nothing to hand a run', () => {
  const m = emptyMemory('crm-sync')
  assert.match(m, /^---\ntitle: Memory\nagent: crm-sync\n---/)
  for (const s of ['What I know', 'Decisions', 'Open threads', 'Last run']) assert.ok(m.includes(`## ${s}`))
  assert.equal(memoryForPrompt(m), null)
})

test('remember appends one line under one section and never twice', () => {
  const a = rememberInto(null, 'x', 'What I know', 'Halter renews in March', '2026-09-06')
  assert.equal(a.changed, true)
  assert.ok(a.content.includes('## What I know\n- 2026-09-06 — Halter renews in March'))
  const b = rememberInto(a.content, 'x', 'What I know', 'halter renews in march')
  assert.equal(b.changed, false)
  const c = rememberInto(b.content, 'x', 'Decisions', 'Skip archived deals')
  assert.ok(c.content.indexOf('## Decisions\n- Skip archived deals') > c.content.indexOf('## What I know'))
  assert.ok(memoryForPrompt(c.content)!.includes('Skip archived deals'))
})

test('a section a person deleted comes back in canonical order', () => {
  const hand = '---\ntitle: Memory\n---\n\n## Open threads\n- ask Craig\n'
  const r = rememberInto(hand, 'x', 'Decisions', 'keep it short')
  assert.ok(r.content.indexOf('## Decisions') < r.content.indexOf('## Open threads'))
})

test('last run is replaced, not appended', () => {
  const one = setLastRun(null, 'x', { date: '2026-09-05', trigger: 'scheduled', summary: 'Synced 3 contacts.' })
  const two = setLastRun(one, 'x', { date: '2026-09-06', trigger: 'manual', summary: 'Nothing changed.', forName: 'Craig' })
  assert.ok(!two.includes('Synced 3 contacts'))
  assert.ok(two.includes('2026-09-06 · manual for Craig\n\nNothing changed.'))
})

test('section names are forgiving', () => {
  assert.equal(memorySectionOf('facts'), 'What I know')
  assert.equal(memorySectionOf('open-threads'), 'Open threads')
  assert.equal(memorySectionOf('Decisions'), 'Decisions')
  assert.equal(memorySectionOf('nope'), null)
})
