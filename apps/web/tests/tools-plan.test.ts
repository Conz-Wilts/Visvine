/**
 * The research half of building a Tool: the brief plan_tool hands back
 * (lib/tools/shared/planBrief.ts), the plan written into the index note, and
 * what an uploaded icon loses on its way to the rail.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-plan.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPlanBrief, takenTypeWords, PLAN_TEMPLATE } from '@/lib/tools/shared/planBrief'
import { withDesignSection } from '@/lib/actions/defs/apps'
import { droppedFromIcon } from '@/lib/actions/defs/toolPlan'

const TYPES = [
  { type: 'person', usage_count: 12, fields: [{ key: 'email', label: 'Email', kind: 'email' }], note_dir: 'people', enabled: true },
  { type: 'space', usage_count: 40, fields: [{ key: 'url', label: 'Website', kind: 'url' }], note_dir: 'spaces', enabled: true },
  { type: 'event', usage_count: 0, fields: [], note_dir: 'events', enabled: false },
  { type: 'deal', usage_count: 7, fields: [{ key: 'stage', label: 'Stage', kind: 'select' }], note_dir: null, enabled: true },
  { type: 'connector', usage_count: 2, fields: [], note_dir: 'connectors', enabled: true },
]

test('the brief says what the space keeps, what it invented, and its own folders — never the platform\'s', () => {
  const brief = buildPlanBrief({
    spaceId: 's1',
    admin: true,
    types: TYPES,
    notePaths: ['deals/acme.md', 'deals/beta.md', 'memos/q3.md', 'agents/digest/index.md', 'tools/x/index.md', 'index.md'],
    tools: [],
  })
  assert.deepEqual(brief.records.map((r) => [r.type, r.count]), [['person', 12], ['space', 40]])
  assert.ok(brief.records.find((r) => r.type === 'space')?.image?.includes('set_image'))
  assert.deepEqual(brief.custom_types, [{ type: 'deal', count: 7, fields: ['stage'] }])
  assert.deepEqual(brief.folders, [{ path: 'deals/', notes: 2 }, { path: 'memos/', notes: 1 }])
  assert.equal(brief.plan_template, PLAN_TEMPLATE)
  assert.ok(brief.plan_template.startsWith('## Design'))
})

test('a request that names a built-in type is warned before add_type refuses it', () => {
  assert.deepEqual(takenTypeWords('an IC tool where we add companies and each person votes'), [
    { word: 'companies', type: 'space' },
    { word: 'person', type: 'person' },
  ])
  const brief = buildPlanBrief({ spaceId: 's1', admin: false, types: TYPES, notePaths: [], tools: [{ name: 'ic', title: 'IC', description: null }], request: 'track companies' })
  assert.match(brief.warnings[0], /"companies" is the built-in `space` type/)
  assert.match(brief.warnings[0], /40 organisation records/)
  assert.match(brief.warnings[1], /already has 1 Tool/)
})

test('the plan lands as the index note\'s Design section, above the docs and the child list', () => {
  const index = '---\ntype: tool\n---\n\nVotes.\n\n## How it works\n\nDocs.\n\n<!-- index:children -->\n<!-- /index:children -->\n'
  const out = withDesignSection(index, '## Design\n\n**Views:** Board')
  assert.ok(out.indexOf('## Design') < out.indexOf('## How it works'))
  assert.equal(out.match(/## Design/g)?.length, 1)
  assert.ok(withDesignSection('Votes.\n', 'Views: Board').endsWith('## Design\n\nViews: Board\n\n'))
})

test('an icon says what the rail will not draw', () => {
  assert.deepEqual(droppedFromIcon('<svg viewBox="0 0 24 24"><path d="M1 1h2" stroke="currentColor"/></svg>'), [])
  assert.deepEqual(
    droppedFromIcon('<svg><text>A</text><linearGradient/><path fill="#f00"/></svg>'),
    ['text', 'gradients', 'colours and styles (the rail paints it in the theme)'],
  )
})
