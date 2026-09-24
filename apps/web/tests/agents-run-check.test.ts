// What a run said it did, held against its trace.
// Run: node --import tsx --test tests/agents-run-check.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { incompleteBecause, nudgeFor, unbackedClaims } from '../lib/agents/shared/runCheck'

test('a claimed write with no write and no writing tool is unbacked', () => {
  assert.equal(unbackedClaims({ wrote: 0.95 }, { writes: 0, tools: ['search_context', 'read_context'] }, 0.8).length, 1)
  assert.deepEqual(unbackedClaims({ wrote: 0.95 }, { writes: 1, tools: ['write_context'] }, 0.8), [])
  assert.deepEqual(unbackedClaims({ wrote: 0.95 }, { writes: 0, tools: ['run_action'] }, 0.8), [])
})

test('a claimed send with nothing that could reach outside is unbacked', () => {
  assert.equal(unbackedClaims({ reached: 0.9 }, { writes: 2, tools: ['write_context'] }, 0.8).length, 1)
  assert.deepEqual(unbackedClaims({ reached: 0.9 }, { writes: 0, tools: ['run_connector'] }, 0.8), [])
})

test('no verdict, or a claim under the floor, accuses nothing', () => {
  assert.deepEqual(unbackedClaims({}, { writes: 0, tools: [] }, 0.8), [])
  assert.deepEqual(unbackedClaims({ wrote: 0.5, reached: 0.79 }, { writes: 0, tools: [] }, 0.8), [])
})

test('a run that stopped short is handed back with what is missing, and fails if it stays short', () => {
  const noWrite = { writes: 0, tools: ['fetch_url'] }
  const claimed = { unbacked: ['It says it wrote or updated something, but the run made no write.'], outcome: 'done' as const }
  assert.match(nudgeFor(claimed, noWrite) ?? '', /call write_context/i)
  assert.ok(incompleteBecause(claimed))

  const partial = { unbacked: [], outcome: 'partial' as const }
  assert.match(nudgeFor(partial, noWrite) ?? '', /remaining steps/)
  assert.ok(incompleteBecause(partial))

  const blocked = { unbacked: [], outcome: 'blocked' as const }
  assert.match(nudgeFor(blocked, noWrite) ?? '', /blocked/)
  assert.equal(nudgeFor(blocked, { writes: 1, tools: ['write_context'] }), null, 'a blocked run that wrote says so; it is not nudged')
  assert.ok(incompleteBecause(blocked))

  // A lean, not confident, is enough for a turn — never for a failure.
  const leaning = { unbacked: [], outcome: null, lean: 'partial' as const }
  assert.match(nudgeFor(leaning, noWrite) ?? '', /remaining steps/)
  assert.equal(incompleteBecause(leaning), null, 'a run that wrote is failed only on a confident verdict')
  assert.ok(incompleteBecause(leaning, { writes: 0 }), 'one that wrote nothing is held to its lean')
  assert.ok(incompleteBecause(null, { writes: 0, promisesMore: true }), 'or to its own promise, judge or no judge')
  assert.equal(incompleteBecause(null, { writes: 2, promisesMore: true }), null)

  for (const fine of [{ unbacked: [], outcome: 'done' as const }, { unbacked: [], outcome: 'nothing' as const }, { unbacked: [], outcome: null }, null]) {
    assert.equal(nudgeFor(fine, noWrite), null)
    assert.equal(incompleteBecause(fine), null)
  }
})
