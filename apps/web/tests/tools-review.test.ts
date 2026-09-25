/**
 * Visvine's global stages, the pure halves: the honeypot a version runs in,
 * what the dynamic run's evidence says, the AI review's prompt and how its
 * answer becomes findings (never more than a flag), and the runner reading a
 * CSP violation off the console.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-review.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseManifestFacts, type ToolManifestFacts } from '@visvine/tool-protocol/manifest'
import {
  canaryIndexOf,
  concretePathOf,
  honeypotBindings,
  planHoneypot,
  scanEvidence,
  type RunEvidence,
} from '@/lib/tools/review/shared/canaries'
import { aiReviewMessages, parseAiReview } from '@/lib/tools/review/shared/aiReview'
import { cspOfConsole } from '@/lib/tools/review/runners'
import { stageStatus } from '@/lib/tools/checks/findings'

function facts(raw: Record<string, unknown>): ToolManifestFacts {
  const parsed = parseManifestFacts({ manifestVersion: 2, ...raw })
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error)
  return parsed.value
}

function counter(): () => string {
  let n = 0
  return () => `vvc-${String(++n).padStart(12, '0')}`
}

const TOOL = facts({
  bindings: {
    notes: { kind: 'folder', label: 'Deal notes', suggest: 'deals/' },
    deal: { kind: 'type', label: 'Deal', suggest: 'Deal', fields: ['stage'] },
    crm: { kind: 'connector', label: 'CRM' },
  },
  permissions: {
    context: { read: ['$notes/**', 'people/*/index.md'], write: ['$notes/**'] },
    records: { read: ['$deal'], write: [{ type: '$deal', fields: ['stage', 'value'] }] },
    connectors: [{ use: '$crm', actions: ['push'] }],
  },
})

test('a slot is bound to its suggestion in the honeypot, or to a stand-in', () => {
  assert.deepEqual(honeypotBindings(TOOL), { notes: 'deals', deal: 'Deal', crm: 'review-crm' })
})

test('a read glob becomes a path it matches', () => {
  assert.equal(concretePathOf('people/*/index.md'), 'people/review-canary/index.md')
  assert.equal(concretePathOf('notes/**'), 'notes/review/review-canary.md')
  assert.equal(concretePathOf('**'), 'review/review-canary.md')
  assert.equal(concretePathOf('meetings/*.md'), 'meetings/review-canary.md')
  assert.equal(concretePathOf('$notes/**'), null)
})

test('the honeypot plants an open and an admins-only canary in every folder it may read, records of its types, and the vault', () => {
  const plan = planHoneypot(TOOL, counter())
  const paths = plan.notes.map((n) => `${n.path}${n.restricted ? ' (admins)' : ''}${n.vault ? ' (vault)' : ''}`)
  assert.deepEqual(paths, [
    'deals/account-plan.md',
    'deals/board-minutes.md (admins)',
    'people/review-canary/index.md',
    'vault/contacts.md (vault)',
    'vault/keys.md (admins) (vault)',
  ])
  assert.deepEqual(plan.types, [{ name: 'Deal', fields: ['stage', 'value'] }])
  assert.equal(plan.records.length, 1)
  assert.match(plan.records[0].content, /^---\ntype: Deal\n/)
  const tokens = [...plan.notes.map((n) => n.token), ...plan.records.map((r) => r.token)]
  assert.equal(new Set(tokens).size, tokens.length, 'every canary is its own token')
  for (const note of plan.notes) assert.ok(note.content.includes(note.token))
  const index = canaryIndexOf(plan)
  assert.equal(Object.keys(index).length, tokens.length)
})

function evidenceFor(plan: ReturnType<typeof planHoneypot>, over: Partial<RunEvidence> = {}): RunEvidence {
  return {
    canaries: canaryIndexOf(plan),
    notes: plan.notes.map((n) => ({ path: n.path, content: n.content, restricted: n.restricted })),
    events: [],
    rendered: true,
    ...over,
  }
}

test('a Tool that reads what it may and writes back where it may leaves a clean run', () => {
  const plan = planHoneypot(TOOL, counter())
  const open = plan.notes[0]
  const findings = scanEvidence(
    evidenceFor(plan, {
      notes: [
        ...evidenceFor(plan).notes,
        // Copying an open note into another open note is what a digest does.
        { path: 'deals/summary.md', content: `Summary: ${open.token}`, restricted: false },
      ],
      events: [{ kind: 'bridge', method: 'context.read', detail: { params: { path: open.path } } }],
    }),
  )
  assert.deepEqual(findings, [])
  assert.equal(stageStatus(findings), 'passed')
})

test('an admins-only canary written where everyone can read it blocks the listing', () => {
  const plan = planHoneypot(TOOL, counter())
  const secret = plan.notes.find((n) => n.restricted && !n.vault)!
  const findings = scanEvidence(
    evidenceFor(plan, { notes: [...evidenceFor(plan).notes, { path: 'deals/shared.md', content: `leak ${secret.token}`, restricted: false }] }),
  )
  assert.equal(findings.length, 1)
  assert.equal(findings[0].rule, 'dynamic.canary-write-out')
  assert.equal(stageStatus(findings), 'blocked')
  // Into another admins-only note it is no wider, so no finding.
  const kept = scanEvidence(
    evidenceFor(plan, { notes: [...evidenceFor(plan).notes, { path: 'deals/private.md', content: `note ${secret.token}`, restricted: true }] }),
  )
  assert.deepEqual(kept, [])
})

test('an admins-only canary sent through a door blocks; an open one is flagged; to the AI it is a note', () => {
  const plan = planHoneypot(TOOL, counter())
  const secret = plan.notes.find((n) => n.restricted && !n.vault)!
  const open = plan.notes[0]
  const door = (method: string, token: string) => ({ kind: 'door', method, detail: { name: 'review-crm', args: { body: token } } })
  assert.equal(scanEvidence(evidenceFor(plan, { events: [door('connectors.call', secret.token)] }))[0]?.severity, 'high')
  assert.equal(scanEvidence(evidenceFor(plan, { events: [door('connectors.call', open.token)] }))[0]?.severity, 'medium')
  assert.equal(scanEvidence(evidenceFor(plan, { events: [door('ai.complete', secret.token)] }))[0]?.severity, 'low')
})

test('an admins-only canary kept in state every viewer shares blocks; in the viewer’s own state it does not', () => {
  const plan = planHoneypot(TOOL, counter())
  const secret = plan.notes.find((n) => n.restricted && !n.vault)!
  const set = (scope: string) => ({ kind: 'bridge', method: 'state.set', detail: { scope, params: { scope, value: secret.token } } })
  assert.equal(scanEvidence(evidenceFor(plan, { events: [set('install')] }))[0]?.rule, 'dynamic.canary-write-out')
  assert.deepEqual(scanEvidence(evidenceFor(plan, { events: [set('user')] })), [])
})

test('a vault token anywhere means the perimeter did not hold', () => {
  const plan = planHoneypot(TOOL, counter())
  const vault = plan.notes.find((n) => n.vault)!
  const inNote = scanEvidence(evidenceFor(plan, { notes: [...evidenceFor(plan).notes, { path: 'deals/x.md', content: vault.token, restricted: true }] }))
  assert.equal(inNote[0]?.rule, 'dynamic.canary-read')
  const inState = scanEvidence(evidenceFor(plan, { events: [{ kind: 'bridge', method: 'state.set', detail: { params: { value: vault.token } } }] }))
  assert.equal(inState[0]?.rule, 'dynamic.canary-read')
})

test('any egress, CSP violation or navigation blocks, and says when it carried planted data', () => {
  const plan = planHoneypot(TOOL, counter())
  const open = plan.notes[0]
  const egress = scanEvidence(evidenceFor(plan, { events: [{ kind: 'egress', detail: { url: `https://evil.example/c?d=${open.token}` } }] }))
  assert.equal(egress[0].severity, 'high')
  assert.match(egress[0].message, /evil\.example — carrying planted data/)
  const csp = scanEvidence(evidenceFor(plan, { events: [{ kind: 'csp', detail: { directive: 'connect-src', blocked: 'https://x.example' } }] }))
  assert.match(csp[0].message, /connect-src reaching x\.example/)
  const nav = scanEvidence(evidenceFor(plan, { events: [{ kind: 'navigation', detail: { url: 'https://y.example/' } }] }))
  assert.equal(nav[0].rule, 'dynamic.navigation')
})

test('a Tool that never rendered says so, as a note rather than a block', () => {
  const plan = planHoneypot(TOOL, counter())
  const findings = scanEvidence(evidenceFor(plan, { rendered: false }))
  assert.deepEqual(findings.map((f) => [f.rule, f.severity]), [['dynamic.no-render', 'low']])
})

test('the AI review is shown the reach in words and the code with line numbers, within a budget', () => {
  const messages = aiReviewMessages({
    title: 'Deal Flow',
    description: 'A board over deals.',
    reach: ['Reads deals/**'],
    files: { 'src/data.js': 'handlers.x = 1', 'src/ui.tsx': 'line one\nline two' },
  })
  assert.equal(messages[0].role, 'system')
  assert.match(messages[0].content, /JSON only/)
  assert.match(messages[1].content, /Title: Deal Flow/)
  assert.match(messages[1].content, /- Reads deals\/\*\*/)
  assert.ok(messages[1].content.indexOf('--- src/ui.tsx') < messages[1].content.indexOf('--- src/data.js'), 'the entry first')
  assert.match(messages[1].content, /2: line two/)
  const big = aiReviewMessages({ title: 't', description: '', reach: [], files: { 'src/ui.tsx': 'x'.repeat(200_000) } })
  assert.ok(big[1].content.length < 70_000)
})

test('the AI can only flag: its findings are medium at most, on files it was shown', () => {
  const text = [
    'Here is my review:',
    '```json',
    JSON.stringify({
      findings: [
        { severity: 'high', file: 'src/ui.tsx', line: 12, message: 'Sends every note to a connector the description never mentions.' },
        { severity: 'low', file: 'src/elsewhere.tsx', line: 3, message: 'Asks for a password.' },
        { severity: 'medium', message: '' },
      ],
    }),
    '```',
  ].join('\n')
  const findings = parseAiReview(text, ['src/ui.tsx'])!
  assert.equal(findings.length, 2)
  assert.deepEqual(findings[0], { rule: 'ai.review', severity: 'medium', message: 'Sends every note to a connector the description never mentions.', file: 'src/ui.tsx', line: 12 })
  assert.deepEqual(findings[1], { rule: 'ai.review', severity: 'low', message: 'Asks for a password.' })
  assert.notEqual(stageStatus(findings), 'blocked')
  assert.deepEqual(parseAiReview('{"findings":[]}', []), [])
  assert.equal(parseAiReview('I think it is fine.', []), null)
})

test('a CSP violation is read off the browser’s console line', () => {
  assert.deepEqual(
    cspOfConsole(`Refused to connect to 'https://evil.example/x' because it violates the following Content Security Policy directive: "connect-src 'none'".`),
    { blocked: 'https://evil.example/x', directive: 'connect-src' },
  )
  assert.deepEqual(
    cspOfConsole(`Refused to load the image 'https://cdn.example/p.png' because it violates the following Content Security Policy directive: "img-src 'self'".`),
    { blocked: 'https://cdn.example/p.png', directive: 'img-src' },
  )
  assert.equal(cspOfConsole('Uncaught TypeError: x is undefined'), null)
})
