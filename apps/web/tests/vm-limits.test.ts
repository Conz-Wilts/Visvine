// What a space may spend on machines, and what an egress log looks like when
// something is wrong. Both pure, so the same answer holds in a test, in the
// tick, and in the refusal a person reads.
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/vm-limits.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BULK_BYTES_THRESHOLD,
  checkQuota,
  DEFAULT_MONTHLY_HOURS,
  DENIAL_ALERT_THRESHOLD,
  detectAnomalies,
  SPREAD_THRESHOLD,
  usdFor,
  type EgressSample,
} from '@/lib/vm/shared/limits'
import { monthOf } from '@/lib/vm/quota'

const AT = new Date('2026-08-29T12:00:00.000Z')

function sample(over: Partial<EgressSample> = {}): EgressSample {
  return { host: 'api.github.com', verdict: 'allow', bytes: 1_000, at: AT, ...over }
}

test('a space under its cap may run, and is told how much is left', () => {
  const verdict = checkQuota({ monthlyHours: 10 }, { seconds: 3_600, execs: 4 })
  assert.equal(verdict.allowed, true)
  assert.equal(verdict.allowed && verdict.remainingSeconds, 9 * 3_600)
})

test('a space at its cap is refused, in money it recognises', () => {
  const verdict = checkQuota({ monthlyHours: 1 }, { seconds: 3_600, execs: 0 })
  assert.equal(verdict.allowed, false)
  // The refusal has to be readable by a person who never thinks in seconds.
  assert.match(verdict.allowed === false ? verdict.reason : '', /1 hours of machine time/)
  assert.match(verdict.allowed === false ? verdict.reason : '', /\$0\.10/)
  assert.match(verdict.allowed === false ? verdict.reason : '', /resets next month/)
})

test('uncapped is a decision an admin makes, not the absence of a setting', () => {
  const uncapped = checkQuota({ monthlyHours: null }, { seconds: 10_000_000, execs: 0 })
  assert.equal(uncapped.allowed, true)
  assert.equal(uncapped.allowed && uncapped.remainingSeconds, null)
  // A cap of zero is a real cap: it stops everything.
  assert.equal(checkQuota({ monthlyHours: 0 }, { seconds: 0, execs: 0 }).allowed, false)
  assert.ok(DEFAULT_MONTHLY_HOURS > 0)
})

test('seconds become the dollars the plan costed them at', () => {
  assert.equal(usdFor(3_600).toFixed(2), '0.10')
  assert.equal(usdFor(0), 0)
})

test('usage is keyed on the UTC month, so a cap resets rather than drifting', () => {
  assert.equal(monthOf(new Date('2026-08-29T23:59:59Z')).toISOString(), '2026-08-01T00:00:00.000Z')
  assert.equal(monthOf(new Date('2026-09-01T00:00:00Z')).toISOString(), '2026-09-01T00:00:00.000Z')
})

test('a pattern of refusals is somebody trying doors, not a typo', () => {
  const quiet = detectAnomalies([sample({ verdict: 'deny' }), sample({ verdict: 'deny' })])
  assert.deepEqual(quiet, [])

  const noisy = detectAnomalies(
    Array.from({ length: DENIAL_ALERT_THRESHOLD }, (_, i) => sample({ verdict: 'deny', host: `h${i}.example.com` })),
  )
  assert.equal(noisy[0]?.kind, 'repeated_denials')
  // Named hosts, but only a handful: an alert is a pointer, not a dump.
  assert.ok(noisy[0]!.hosts.length <= 5)
})

test('a copy leaving through an allowed host is the shape exfiltration has', () => {
  const found = detectAnomalies([
    sample({ host: 'api.github.com', bytes: BULK_BYTES_THRESHOLD }),
    sample({ host: 'api.github.com', bytes: 1_000 }),
  ])
  assert.equal(found[0]?.kind, 'bulk_egress')
  assert.deepEqual(found[0]?.hosts, ['api.github.com'])

  // Refused traffic does not count toward it: nothing left.
  assert.deepEqual(
    detectAnomalies([sample({ verdict: 'deny', bytes: BULK_BYTES_THRESHOLD * 10 })]).filter(
      (a) => a.kind === 'bulk_egress',
    ),
    [],
  )
})

test('touching everything is itself the signal', () => {
  const spread = detectAnomalies(
    Array.from({ length: SPREAD_THRESHOLD }, (_, i) => sample({ host: `site${i}.example.com` })),
  )
  assert.ok(spread.some((a) => a.kind === 'destination_spread'))
})

test('an ordinary hour raises nothing', () => {
  const ordinary = [
    ...Array.from({ length: 200 }, () => sample()),
    ...Array.from({ length: 3 }, () => sample({ verdict: 'deny', host: 'evil.example.com' })),
  ]
  assert.deepEqual(detectAnomalies(ordinary), [])
  assert.deepEqual(detectAnomalies([]), [])
})
