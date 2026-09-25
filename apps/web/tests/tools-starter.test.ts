/**
 * The author's own repo: the generated docs and types stay in step with the
 * server's SDK; the starter reads as a package the server takes; and the
 * offline runtime answers under the same gates the bridge applies.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-starter.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { renderKitDts, renderStarterAgents, renderStarterComponents } from '@/lib/tools/starterDocs'
import { parseManifestFacts } from '@visvine/tool-protocol/manifest'
import { ISOLATE_METHODS, ISOLATE_PARAMS } from '@visvine/tool-protocol/isolate'
import { BRIDGE_METHODS } from '@visvine/tool-protocol/protocol'
import { createMockBridge, loadFixtures } from '../../../packages/tool-kit/src/index'
import { projectFiles, readProject, releaseNotes } from '../../../packages/tool-cli/src/project'
import { buildProject, checkProject, describeCheck } from '../../../packages/tool-cli/src/local'

const ROOT = resolve(__dirname, '..', '..', '..')
const STARTER = join(ROOT, 'packages', 'tool-starter')

test('the committed docs and types are what the server’s SDK renders (run tools:packages)', () => {
  assert.equal(readFileSync(join(ROOT, 'packages', 'tool-kit', 'index.d.ts'), 'utf8'), renderKitDts())
  assert.equal(readFileSync(join(STARTER, 'AGENTS.md'), 'utf8'), renderStarterAgents())
  assert.equal(readFileSync(join(STARTER, 'COMPONENTS.md'), 'utf8'), renderStarterComponents())
})

test('the kit’s types are a module of their own, not an ambient block', () => {
  const dts = renderKitDts()
  assert.doesNotMatch(dts, /declare module '@visvine\/tool-kit'/)
  assert.match(dts, /^export function useVisvine\(\): VisvineApi$/m)
  assert.match(dts, /^export function useCollection</m)
})

test('the starter reads as a package Visvine takes, and builds and checks clean', async () => {
  const pkg = readProject(STARTER)
  assert.equal(pkg.name, 'my-tool')
  assert.deepEqual(Object.keys(pkg.modules), ['src/slug.ts'])
  assert.ok(pkg.data?.includes('handlers.summary'))
  const build = await buildProject(pkg)
  assert.equal(build.ok, true, JSON.stringify(build.errors))
  const result = describeCheck(build, await checkProject(pkg, build))
  assert.equal(result.ok, true, result.errors.join('\n'))
  assert.equal(releaseNotes(STARTER), 'The notes in one folder, newest first, with a quick add.')
})

test('a project carries its sources and docs, never its fixtures, tests or declarations', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vv-project-'))
  mkdirSync(join(dir, 'src'))
  mkdirSync(join(dir, 'fixtures'))
  writeFileSync(join(dir, 'visvine-tool.json'), '{}')
  writeFileSync(join(dir, 'README.md'), '# X')
  writeFileSync(join(dir, 'src', 'ui.tsx'), 'export default () => null')
  writeFileSync(join(dir, 'src', 'ui.test.tsx'), 'test')
  writeFileSync(join(dir, 'src', 'env.d.ts'), 'declare const x: 1')
  writeFileSync(join(dir, 'fixtures', 'space.json'), '{}')
  assert.deepEqual(Object.keys(projectFiles(dir)).sort(), ['README.md', 'src/ui.tsx', 'visvine-tool.json'])
})

test('data.js reaches every bridge method but data.call and subject.get, positional as on the server', () => {
  assert.deepEqual(
    [...ISOLATE_METHODS].sort(),
    BRIDGE_METHODS.filter((m) => !['data.call', 'subject.get', 'resources.blob'].includes(m)).sort(),
  )
  assert.deepEqual(ISOLATE_PARAMS['context.list']!([]), {})
  assert.deepEqual(ISOLATE_PARAMS['context.search']!(['acme', 5]), { query: 'acme', k: 5 })
  assert.deepEqual(ISOLATE_PARAMS['connectors.call']!(['crm', 'return 1']), { name: 'crm', code: 'return 1' })
  assert.deepEqual(ISOLATE_PARAMS['connectors.call']!(['crm', { action: 'find', args: { q: 1 } }]), { name: 'crm', action: 'find', args: { q: 1 } })
  assert.deepEqual(ISOLATE_PARAMS['collections.count']!(['votes', { groupBy: 'choice' }]), { collection: 'votes', groupBy: 'choice' })
})

// ── the offline runtime ──────────────────────────────────────────────────────

function fixtures(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vv-fixtures-'))
  mkdirSync(join(dir, 'notes', 'deals'), { recursive: true })
  mkdirSync(join(dir, 'notes', 'hr'), { recursive: true })
  writeFileSync(join(dir, 'space.json'), JSON.stringify({ viewer: { id: 'ada', name: 'Ada', isAdmin: false }, bindings: { deals: 'deals' } }))
  writeFileSync(join(dir, 'notes', 'deals', 'acme.md'), '---\ntitle: Acme\ntype: Deal\nstage: Lead\n---\n\nA big one.\n')
  writeFileSync(join(dir, 'notes', 'deals', 'globex.md'), '---\ntitle: Globex\ntype: Deal\nstage: Won\n---\n\nSigned.\n')
  writeFileSync(join(dir, 'notes', 'hr', 'pay.md'), '---\ntitle: Pay\n---\n\nSalaries.\n')
  return dir
}

function facts() {
  const parsed = parseManifestFacts({
    sdk: '^2',
    bindings: { deals: { kind: 'folder', label: 'Deals', suggest: 'deals' } },
    permissions: { context: { read: ['$deals/**'], write: ['$deals/**'] }, records: { read: ['Deal'], write: [{ type: 'Deal', fields: ['stage'] }] } },
    collections: { votes: { schema: { type: 'object', properties: { choice: { type: 'string', enum: ['a', 'b'] } }, required: ['choice'] }, read: 'all', write: 'own' } },
  })
  assert.equal(parsed.ok, true)
  return (parsed as { ok: true; value: Parameters<typeof createMockBridge>[0]['tool']['facts'] }).value
}

test('offline, the Tool’s declaration answers first — as on the server', async () => {
  const changed: string[][] = []
  const bridge = createMockBridge({ tool: { name: 't', title: 'T', facts: facts(), dataBundle: '' }, space: loadFixtures(fixtures()), onChange: (p) => changed.push(p) })
  const list = await bridge.call('context.list', {})
  assert.deepEqual(list.ok && (list.value as Array<{ path: string }>).map((e) => e.path), ['deals/acme.md', 'deals/globex.md'])
  const outside = await bridge.call('context.read', { path: 'hr/pay.md' })
  assert.equal(!outside.ok && outside.error.code, 'perimeter')
  const write = await bridge.call('context.write', { path: 'deals/initech.md', content: '# Initech' })
  assert.equal(write.ok, true)
  assert.deepEqual(changed.at(-1), ['deals/initech.md'])
  assert.equal(!(await bridge.call('context.write', { path: 'hr/x.md', content: 'x' })).ok, true)
  const records = await bridge.call('records.query', { type: 'Deal', where: [{ key: 'stage', op: 'eq', value: 'Won' }] })
  assert.deepEqual(records.ok && (records.value as { rows: Array<{ title: string }> }).rows.map((r) => r.title), ['Globex'])
  const badField = await bridge.call('records.update', { path: 'deals/acme.md', fields: { amount: 5 } })
  assert.equal(!badField.ok && badField.error.code, 'perimeter')
  const noAi = await bridge.call('ai.complete', { prompt: 'hi' })
  assert.equal(!noAi.ok && noAi.error.code, 'perimeter')
  assert.equal(bridge.init().degraded, null)
})

test('offline collections keep the rules: schema, own rows, the tally', async () => {
  const bridge = createMockBridge({ tool: { name: 't', title: 'T', facts: facts(), dataBundle: '' }, space: loadFixtures(fixtures()) })
  assert.equal((await bridge.call('collections.insert', { collection: 'votes', data: { choice: 'a' } })).ok, true)
  const bad = await bridge.call('collections.insert', { collection: 'votes', data: { choice: 'z' } })
  assert.equal(!bad.ok && bad.error.code, 'invalid')
  const undeclared = await bridge.call('collections.insert', { collection: 'ballots', data: {} })
  assert.equal(!undeclared.ok && undeclared.error.code, 'perimeter')
  const mine = await bridge.call('collections.insert', { collection: 'votes', data: { choice: 'b' } })
  bridge.setViewer({ id: 'bob', name: 'Bob' })
  const theirs = await bridge.call('collections.delete', { collection: 'votes', id: mine.ok && (mine.value as { id: string }).id })
  assert.equal(!theirs.ok && theirs.error.code, 'forbidden')
  await bridge.call('collections.insert', { collection: 'votes', data: { choice: 'a' } })
  const tally = await bridge.call('collections.count', { collection: 'votes', groupBy: 'choice' })
  assert.deepEqual(tally.ok && tally.value, { total: 3, groups: [{ value: 'a', count: 2 }, { value: 'b', count: 1 }] })
})

test('offline data.js runs its handlers with the same visvine, refused as the server refuses', async () => {
  const dataBundle = `handlers.count = async (args, visvine) => (await visvine.context.list(args.folder + '/**')).length
handlers.peek = async (args, visvine) => visvine.context.read('hr/pay.md')`
  const bridge = createMockBridge({ tool: { name: 't', title: 'T', facts: facts(), dataBundle }, space: loadFixtures(fixtures()) })
  const counted = await bridge.call('data.call', { fn: 'count', args: { folder: 'deals' } })
  assert.deepEqual(counted, { ok: true, value: 2 })
  const peek = await bridge.call('data.call', { fn: 'peek', args: null })
  assert.equal(!peek.ok && peek.error.code, 'perimeter')
  const missing = await bridge.call('data.call', { fn: 'nope', args: null })
  assert.equal(!missing.ok && missing.error.code, 'not_found')
})
