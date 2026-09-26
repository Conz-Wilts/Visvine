/**
 * The starting Tools (lib/tools/templates): each ships compiled current, types
 * against the kit's published .d.ts, compiles as a Tool compiles, carries an
 * example spec its own checks accept, declares facts the manifest parser
 * accepts, and is chosen for the requests it is for.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-templates.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compileToolUi } from '@/lib/tools/compile'
import { parseManifestFacts } from '@visvine/tool-protocol/manifest'
import { applySpec, checkSpec, defaultSpecText, matchTemplate, TOOL_TEMPLATES } from '@/lib/tools/templates'
import { generateTemplateSources } from '../scripts/build-tool-templates'
import { readFileSync } from 'node:fs'

const APP = join(__dirname, '..')

/** The example spec is a TS object literal; read it as the value it is. */
function exampleSpec(id: string): Record<string, unknown> {
  return new Function(`return (${defaultSpecText(id)})`)() as Record<string, unknown>
}

test('sources.generated.ts is current', () => {
  assert.equal(readFileSync(join(APP, 'lib', 'tools', 'templates', 'sources.generated.ts'), 'utf8'), generateTemplateSources())
})

test('every template compiles as a Tool, with its example spec and after applySpec', async () => {
  for (const t of TOOL_TEMPLATES) {
    const spec = exampleSpec(t.id)
    const result = await compileToolUi(applySpec(t.id, spec))
    assert.ok(result.ok, `${t.id}: ${result.ok ? '' : result.errors.map((e) => e.message).join('; ')}`)
  }
})

test("each template's example spec passes its own checks", () => {
  for (const t of TOOL_TEMPLATES) {
    const checked = checkSpec(t, exampleSpec(t.id))
    assert.ok(checked.ok, `${t.id}: ${checked.ok ? '' : checked.problems.join('; ')}`)
  }
})

test('the facts a template declares are a manifest the parser accepts', () => {
  for (const t of TOOL_TEMPLATES) {
    const facts = t.facts(exampleSpec(t.id))
    const parsed = parseManifestFacts({ manifestVersion: 2, sdk: '^2.0.0', collections: facts.collections })
    assert.ok(parsed.ok, `${t.id}: ${parsed.ok ? '' : parsed.error}`)
  }
})

test('a spec that points at a missing or wrong-kind field is refused with the reason', () => {
  const tracker = TOOL_TEMPLATES.find((t) => t.id === 'tracker')!
  const spec = { ...exampleSpec('tracker'), groupBy: 'value' }
  const checked = checkSpec(tracker, spec)
  assert.equal(checked.ok, false)
  assert.ok(!checked.ok && checked.problems.some((p) => p.includes('groupBy')))
})

test('requests land on the template they are for, and a vague one on the tracker', () => {
  const cases: Array<[string, string]> = [
    ['crm for my team', 'tracker'],
    ['track stuff', 'tracker'],
    ['make me something', 'tracker'],
    ['hiring pipeline', 'tracker'],
    ['bug list', 'tracker'],
    ['expenses dashboard', 'dashboard'],
    ['budget', 'dashboard'],
    ['a poll for where to have lunch', 'poll'],
    ['team survey', 'poll'],
    ['daily standup', 'checkin'],
    ['habit tracker', 'checkin'],
    ['vendor directory', 'directory'],
    ['recipes', 'directory'],
    ['kudos board', 'leaderboard'],
    ['step challenge leaderboard', 'leaderboard'],
  ]
  for (const [request, id] of cases) assert.equal(matchTemplate(request).id, id, request)
})

test("every template types against the kit's published .d.ts", () => {
  const dir = mkdtempSync(join(tmpdir(), 'vv-templates-'))
  const react = join(APP, 'node_modules', '@types', 'react')
  const kit = join(APP, '..', '..', 'packages', 'tool-kit', 'index.d.ts')
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        jsx: 'react-jsx',
        module: 'esnext',
        moduleResolution: 'bundler',
        target: 'es2022',
        noEmit: true,
        skipLibCheck: true,
        lib: ['es2023', 'dom'],
        typeRoots: [],
        paths: { '@visvine/tool-kit': [kit], react: [join(react, 'index.d.ts')], 'react/jsx-runtime': [join(react, 'jsx-runtime.d.ts')] },
      },
      files: [kit],
      include: [join(APP, 'lib', 'tools', 'templates', 'sources', '*.tsx')],
    }),
  )
  try {
    execFileSync(join(APP, 'node_modules', '.bin', 'tsc'), ['-p', dir], { encoding: 'utf8' })
  } catch (err) {
    assert.fail(String((err as { stdout?: string }).stdout ?? err))
  }
})
