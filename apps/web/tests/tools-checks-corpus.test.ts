/**
 * The static stages against a corpus of benign and malicious Tools
 * (scripts/fixtures/tools/corpus/): every malicious sample is blocked or
 * flagged, by the rule meant to catch it, and no benign one is blocked.
 *
 * Each sample is compiled for real (lib/tools/compile.ts) and parsed for real
 * (lib/tools/config.ts), so the compatibility stage reads the same build a
 * publish would. The secrets and the bidirectional characters are spliced in
 * here rather than committed, so the repository never carries a live-looking
 * key or a Trojan Source line of its own.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-checks-corpus.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compileToolData, compileToolUi } from '@/lib/tools/compile'
import { parseToolConfig } from '@/lib/tools/config'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'
import { runStaticChecks } from '@/lib/tools/checks/analyze'
import { reportStatus, type CheckReport } from '@/lib/tools/checks/findings'

const FIXTURES = join(__dirname, '..', 'scripts', 'fixtures', 'tools')
const CORPUS = join(FIXTURES, 'corpus')

const SPLICE: Record<string, string> = {
  __STRIPE_LIVE__: ['sk', 'live', 'a1B2c3D4e5F6g7H8i9J0k1L2m3'].join('_'),
  __AWS_KEY__: ['AKIA', 'Q3ZT7XK2B9MW4PLD'].join(''),
  __RLO__: '‮',
  __LRI__: '⁦',
}

function read(dir: string, file: string): string | null {
  const path = join(dir, file)
  if (!existsSync(path)) return null
  let text = readFileSync(path, 'utf8')
  for (const [marker, value] of Object.entries(SPLICE)) text = text.split(marker).join(value)
  return text
}

async function check(dir: string, name: string): Promise<CheckReport> {
  const index = read(dir, 'index.md')
  const ui = read(dir, 'ui.tsx')
  const data = read(dir, 'data.js')
  const parsed = index ? parseToolConfig(parseFrontmatter(index), name) : null
  const uiBuild = ui ? await compileToolUi(ui) : null
  const dataBuild = data ? await compileToolData(data) : null
  const errors = [
    ...(uiBuild && !uiBuild.ok ? uiBuild.errors.map((e) => ({ ...e, file: 'ui.tsx' })) : []),
    ...(dataBuild && !dataBuild.ok ? dataBuild.errors.map((e) => ({ ...e, file: 'data.js' })) : []),
  ]
  const warnings = [
    ...(uiBuild ? uiBuild.warnings.map((w) => ({ ...w, file: 'ui.tsx' })) : []),
    ...(dataBuild ? dataBuild.warnings.map((w) => ({ ...w, file: 'data.js' })) : []),
  ]
  return runStaticChecks({
    index,
    ui,
    data,
    config: parsed?.ok ? parsed.config : null,
    build: { ok: errors.length === 0, errors, warnings, configError: parsed && !parsed.ok ? parsed.error : null },
  })
}

function describe(report: CheckReport): string {
  return [...report.compatibility.findings, ...report.security.findings]
    .map((f) => `  [${f.severity}] ${f.rule} ${f.file ?? ''}:${f.line ?? ''} ${f.message}`)
    .join('\n')
}

/** The rule each malicious sample exists to trip. */
const EXPECT: Record<string, string> = {
  bidi: 'obfuscation.bidi',
  'cookie-beacon': 'escape.cookie',
  'css-exfil': 'exfil.css-url',
  'dns-prefetch': 'exfil.prefetch',
  'document-write': 'escape.document-write',
  'escaped-ident': 'obfuscation.escaped-identifier',
  'eval-loader': 'escape.dynamic-code',
  'forged-bridge': 'escape.post-message',
  'function-ctor': 'escape.function-constructor',
  laundering: 'risk.permissions',
  'meta-refresh': 'escape.meta-http-equiv',
  minified: 'obfuscation.minified',
  'node-probe': 'escape.runtime-probe',
  obfuscated: 'obfuscation.computed-global',
  phishing: 'phishing.password-input',
  popup: 'escape.popup',
  reflect: 'obfuscation.computed-global',
  secret: 'secret.stripe',
  'send-beacon': 'exfil.network',
  srcdoc: 'escape.srcdoc',
  'storage-probe': 'sandbox.storage',
  'string-timer': 'escape.dynamic-code',
  'top-nav': 'escape.other-window',
  undeclared: 'usage.undeclared-read',
  webrtc: 'exfil.webrtc',
  'websocket-data': 'exfil.network',
  'window-alias': 'obfuscation.window-alias',
}

const malicious = readdirSync(join(CORPUS, 'malicious')).sort()
const benign = [
  ...readdirSync(join(CORPUS, 'benign'))
    .sort()
    .map((name) => ({ name, dir: join(CORPUS, 'benign', name) })),
  // The fixtures the live suites install: they must publish.
  { name: 'hello', dir: join(FIXTURES, 'hello') },
  { name: 'sections', dir: join(FIXTURES, 'sections') },
]

test('the corpus is the size the exit criterion names', () => {
  assert.ok(malicious.length >= 20, `only ${malicious.length} malicious samples`)
  assert.ok(benign.length >= 6, `only ${benign.length} benign samples`)
  assert.deepEqual(malicious, Object.keys(EXPECT).sort(), 'every malicious sample names the rule it trips')
})

for (const name of malicious) {
  test(`malicious: ${name} is blocked or flagged by ${EXPECT[name]}`, async () => {
    const report = await check(join(CORPUS, 'malicious', name), name)
    const status = reportStatus(report)
    assert.notEqual(status, 'passed', `${name} passed:\n${describe(report)}`)
    const rules = [...report.compatibility.findings, ...report.security.findings].map((f) => f.rule)
    assert.ok(rules.includes(EXPECT[name]), `${name} did not trip ${EXPECT[name]}:\n${describe(report)}`)
  })
}

for (const { name, dir } of benign) {
  test(`benign: ${name} is not blocked`, async () => {
    const report = await check(dir, name)
    assert.notEqual(report.compatibility.status, 'blocked', `${name}:\n${describe(report)}`)
    assert.notEqual(report.security.status, 'blocked', `${name}:\n${describe(report)}`)
  })
}

test('the hostile escape fixture is blocked — the live suite runs it past the checks on purpose', async () => {
  const report = await check(join(FIXTURES, 'hostile'), 'hostile')
  assert.equal(report.security.status, 'blocked')
})
