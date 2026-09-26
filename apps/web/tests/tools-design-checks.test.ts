/**
 * The design rules of the compatibility stage (lib/tools/checks/design.ts):
 * the faults a person sees in a second — a boxed page, a frame-sized overlay,
 * a text box for a fixed set, an add button gone after the first item — said
 * to the author as advice, never as a block.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-design-checks.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { designFindings } from '@/lib/tools/checks/design'
import { parseToolConfig } from '@/lib/tools/config'

function config(extra: Record<string, unknown> = {}) {
  const parsed = parseToolConfig({ type: 'tool', title: 'X', description: 'x', ...extra }, 'x')
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error)
  return parsed.config
}

const rules = (ui: string, cfg = config()) => designFindings({ ui, config: cfg }).map((f) => f.rule).sort()

const companies = {
  collections: {
    companies: {
      schema: { type: 'object', properties: { name: { type: 'string' }, stage: { type: 'string', enum: ['Seed', 'Series A'] } } },
      read: 'all',
      write: 'all',
    },
  },
}

test('a Tool built the way the catalog says raises nothing', () => {
  const ui = `export default function App() {
  const [section] = useSection()
  useBandAction('add', () => setOpen(true))
  void visvine.collections.insert('companies', {})
  return <div className="px-6 py-5"><Select value={stage} options={[]} /></div>
}`
  const cfg = config({ ...companies, surfaces: { actions: [{ id: 'add', label: 'Add company' }] } })
  assert.deepEqual(rules(ui, cfg), [])
})

test('each fault is named once, and none of them blocks', () => {
  const ui = `export default function App() {
  return (
    <div className="mx-auto max-w-5xl rounded-xl border">
      <Tabs tabs={[]} active="a" onChange={() => {}} />
      <div style={{ height: '100vh', color: '#ff0000' }} className="bg-gray-100" />
      <Input value={stage} onChange={(e) => setStage(e.target.value)} />
      <Input value={stage} />
      <button onClick={() => visvine.collections.insert('companies', {})}>Add</button>
    </div>
  )
}`
  const found = designFindings({ ui, config: config(companies) })
  assert.deepEqual(found.map((f) => f.rule).sort(), [
    'design.boxed',
    'design.colour',
    'design.enum-input',
    'design.no-band-action',
    'design.tab-strip',
    'design.viewport',
  ])
  assert.ok(found.every((f) => f.severity === 'low'))
  assert.equal(found.find((f) => f.rule === 'design.viewport')?.line, 5)
})

test('Tabs inside a Tool that declares its sections is a switch inside one section, not a fault', () => {
  const cfg = config({ surfaces: { nav: { style: 'tabs', sections: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] } } })
  assert.deepEqual(rules(`export default () => <Tabs tabs={[]} active="a" onChange={() => {}} />`, cfg), [])
})

test('a fixed class is caught in a className, and the word elsewhere is not', () => {
  assert.deepEqual(rules(`export default () => <div className="fixed inset-0" />`), ['design.viewport'])
  assert.deepEqual(rules(`export default () => <p>The price is fixed</p>`), [])
})

test('the rules read the modules as well as ui.tsx, and point at the file', () => {
  const found = designFindings({ ui: 'export default () => null', modules: { 'src/board.tsx': `export const B = () => <div className="text-red-500" />` }, config: null })
  assert.deepEqual(found.map((f) => [f.rule, f.file]), [['design.colour', 'src/board.tsx']])
})
