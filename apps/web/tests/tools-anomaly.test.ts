/**
 * Monitoring's rules: a day's counts against a Tool's own baseline, and when
 * a listing's open incidents hold it everywhere. Pure.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-anomaly.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { anomaliesFor, baselineOf, suspensionDecision, type DayCounts, type SignalIncident } from '@/lib/tools/shared/monitoring'
import { directoryOpenTo } from '@/lib/tools/directory'

const QUIET: DayCounts = { calls: 200, refusals: 2, errors: 1, bytesRead: 200_000 }

test('a baseline is the mean of the days there are, and there is none on a first day', () => {
  assert.equal(baselineOf([]), null)
  assert.deepEqual(baselineOf([QUIET, { calls: 100, refusals: 4, errors: 3, bytesRead: 100_000 }]), {
    calls: 150,
    refusals: 3,
    errors: 2,
    bytesRead: 150_000,
  })
})

test('an ordinary day says nothing', () => {
  assert.deepEqual(anomaliesFor(QUIET, QUIET), [])
  assert.deepEqual(anomaliesFor({ calls: 5, refusals: 5, errors: 0, bytesRead: 1_000 }, null), [], 'a handful of refusals is not a spike')
})

test('refusals spiking against the baseline are flagged', () => {
  const found = anomaliesFor({ calls: 100, refusals: 60, errors: 0, bytesRead: 100_000 }, QUIET)
  assert.deepEqual(found.map((a) => [a.rule, a.severity]), [['refusals', 'flag']])
  assert.match(found[0].message, /Refused 60 times today \(usually 2\)/)
  // A Tool that is always refused this much is its normal, not a spike.
  assert.deepEqual(anomaliesFor({ calls: 100, refusals: 60, errors: 0, bytesRead: 0 }, { calls: 100, refusals: 55, errors: 0, bytesRead: 0 }), [])
})

test('reading far more than it usually reads is flagged', () => {
  const found = anomaliesFor({ calls: 300, refusals: 0, errors: 0, bytesRead: 40_000_000 }, QUIET)
  assert.deepEqual(found.map((a) => a.rule), ['reads'])
  assert.match(found[0].message, /Read 40 MB today/)
  assert.deepEqual(anomaliesFor({ calls: 300, refusals: 0, errors: 0, bytesRead: 4_000_000 }, null), [], 'small days never read as much')
})

test('errors and timeouts spiking are a quality flag', () => {
  const found = anomaliesFor({ calls: 50, refusals: 0, errors: 30, bytesRead: 0 }, QUIET)
  assert.deepEqual(found.map((a) => [a.rule, a.severity]), [['errors', 'quality']])
})

const nav = (viewerId: string | null, source = 'viewer'): SignalIncident => ({ kind: 'navigation', severity: 'severe', source, viewerId })
const csp = (viewerId: string): SignalIncident => ({ kind: 'csp', severity: 'flag', source: 'viewer', viewerId })

test('one viewer’s severe signal does not hold a listing; a second viewer’s does', () => {
  assert.deepEqual(suspensionDecision([nav('ana')]), { suspend: false })
  assert.deepEqual(suspensionDecision([nav('ana'), nav('ana')]), { suspend: false }, 'the same person twice is one person')
  const held = suspensionDecision([nav('ana'), nav('ben')])
  assert.ok(held.suspend)
  assert.match(held.suspend ? held.reason : '', /tried to leave its frame for 2 people/)
})

test('CSP violations count once two viewers report them', () => {
  assert.deepEqual(suspensionDecision([csp('ana')]), { suspend: false })
  assert.ok(suspensionDecision([csp('ana'), csp('ben')]).suspend)
  assert.ok(suspensionDecision([csp('ana'), nav('ben')]).suspend, 'different signals from two people add up')
})

test('Visvine’s dynamic run alone is enough; a member’s report never is', () => {
  const dynamic = suspensionDecision([{ kind: 'canary', severity: 'severe', source: 'dynamic', viewerId: null }])
  assert.ok(dynamic.suspend)
  assert.match(dynamic.suspend ? dynamic.reason : '', /dynamic run caught it/)
  const reports: SignalIncident[] = ['ana', 'ben', 'cy'].map((viewerId) => ({ kind: 'report', severity: 'report', source: 'viewer', viewerId }))
  assert.deepEqual(suspensionDecision(reports), { suspend: false })
  assert.deepEqual(suspensionDecision([{ kind: 'rescan', severity: 'severe', source: 'rescan', viewerId: null }]), { suspend: false }, 'a rules change is a person’s call')
  assert.deepEqual(suspensionDecision([nav(null)]), { suspend: false }, 'a signal with nobody behind it counts for no one')
})

test('the directory is open, and an operator can close it to reviewers', () => {
  assert.equal(directoryOpenTo('member@x.dev', {}), true)
  assert.equal(directoryOpenTo('member@x.dev', { TOOLS_DIRECTORY: 'reviewers' }), false)
})

test('a known advisory against a declared dependency flags a version, never blocks it', async () => {
  const { runStaticChecks } = await import('@/lib/tools/checks/analyze')
  const { parseToolConfig } = await import('@/lib/tools/config')
  const parsed = parseToolConfig(
    { type: 'tool', title: 'Dates', manifestVersion: 2, sdk: '^2', dependencies: { 'date-fns': '^4' }, permissions: {} } as never,
    'dates',
  )
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error)
  const input = {
    index: '---\ntype: tool\n---\nDates.',
    ui: "import { format } from 'date-fns'\nexport default function App() { return <p>{format(new Date(0), 'yyyy')}</p> }\n",
    data: null,
    config: parsed.config,
    build: { ok: true, errors: [], warnings: [], configError: null },
  }
  const advisory = { package: 'date-fns', advisoryId: 'GHSA-xxxx', summary: 'Parsing is slow on long input', severity: 'high' as const }
  const flagged = await runStaticChecks({ ...input, advisories: [advisory] })
  const finding = flagged.security.findings.find((f) => f.rule === 'dependency.advisory')
  assert.ok(finding && finding.severity === 'medium', JSON.stringify(flagged.security.findings))
  assert.notEqual(flagged.security.status, 'blocked')
  const other = await runStaticChecks({ ...input, advisories: [{ ...advisory, package: 'zod' }] })
  assert.ok(!other.security.findings.some((f) => f.rule === 'dependency.advisory'), 'an undeclared package is not this Tool’s')
})
