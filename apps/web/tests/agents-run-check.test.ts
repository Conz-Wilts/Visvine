// What a run said it did, held against its trace.
// Run: node --import tsx --test tests/agents-run-check.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { unbackedClaims } from '../lib/agents/shared/runCheck'

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
