/**
 * trackRecords (lib/models/shared/trackRecords.ts): how often each model
 * finished its jobs, counting only what the model decides.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/model-track-records.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { trackRecords } from '@/lib/models/shared/trackRecords'

test('a model track record counts only what the model decides', () => {
  const runs = [
    { model: 'anthropic/a', status: 'succeeded', terminalReason: 'finished' },
    { model: 'anthropic/a', status: 'failed', terminalReason: 'incomplete' },
    { model: 'anthropic/a', status: 'failed', terminalReason: 'budget' },
    { model: 'anthropic/b', status: 'failed', terminalReason: 'narrated' },
    { model: 'anthropic/b', status: 'running', terminalReason: null },
  ]
  assert.deepEqual(trackRecords(runs), [
    { model: 'anthropic/a', finished: 1, short: 1 },
    { model: 'anthropic/b', finished: 0, short: 1 },
  ])
})
