// A caller waiting on a run it triggered is a request, and a request that
// waits out a 25-minute run holds the instance serving it for 25 minutes.
// `dispatchWithin` is where that wait is bounded — for the "Run now" route and
// for the `run_agent` action, which are the two doors onto claimManualRun.
//
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/agents-dispatch-wait.test.ts

import test from 'node:test'
import assert from 'node:assert/strict'
import { dispatchWithin, type DispatchResult } from '@/lib/agents/dispatch'
import { MAX_RUN_MS, RUN_AWAIT_MS } from '@/lib/agents/limits'

const done: DispatchResult = { ok: true, outcome: null }

test('a run that finishes in time is answered with its outcome', async () => {
  assert.deepEqual(await dispatchWithin(Promise.resolve(done), 1_000), done)
})

test('a run still going hands back null, and keeps going', async () => {
  let settled = false
  const slow = new Promise<DispatchResult>((resolve) => {
    setTimeout(() => {
      settled = true
      resolve(done)
    }, 60).unref?.()
  })

  assert.equal(await dispatchWithin(slow, 10), null, 'the caller is let go')
  assert.equal(settled, false, 'and let go BEFORE the run finished')

  // The point of null rather than an error: the run is untouched. It is
  // dispatched over its own request, so nothing here was carrying it.
  assert.deepEqual(await slow, done)
  assert.equal(settled, true)
})

test('a dispatch that throws is a result, never an unhandled rejection', async () => {
  const thrown = await dispatchWithin(Promise.reject(new Error('run endpoint answered 500')), 1_000)
  assert.deepEqual(thrown, { ok: false, error: 'run endpoint answered 500' })
})

test('an abandoned dispatch that later rejects is still caught', async () => {
  // The failure this guards: give up the wait, the promise rejects with nobody
  // listening, and the process takes an unhandled rejection.
  let reject!: (e: Error) => void
  const pending = new Promise<DispatchResult>((_, r) => {
    reject = r
  })
  const raced = dispatchWithin(pending, 5)
  assert.equal(await raced, null)
  reject(new Error('too late'))
  await new Promise((r) => setTimeout(r, 20))
})

test('the wait is a small fraction of what a run may take', () => {
  assert.ok(RUN_AWAIT_MS < MAX_RUN_MS, 'waiting out the run cap is the thing being fixed')
  // And still long enough that an ordinary run answers in one round trip.
  assert.ok(RUN_AWAIT_MS >= 30_000)
})
