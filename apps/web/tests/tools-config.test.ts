/**
 * The Tool note contract (lib/tools/config.ts): the path helpers, the source
 * wrapper the note store's `.md` rule forces on us, the frontmatter parser and
 * the starter note round-tripping through it.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-config.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isToolPath,
  newToolIndexNote,
  parseToolConfig,
  TOOL_NAME_RE,
  TOOL_RAIL_ICONS,
  TOOL_SOURCE_FILES,
  TOOL_TAGS_MAX,
  TOOLS_DIR,
  toolDataPath,
  toolFileKindOfPath,
  toolFolderPath,
  toolIndexPath,
  toolNameOfPath,
  toolUiPath,
  unwrapSource,
  wrapSource,
  type ToolConfig,
  type ToolTypeSurface,
} from '@/lib/tools/config'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'

// ── paths ──

test('a tool folder holds an index and the two sources', () => {
  assert.equal(TOOLS_DIR, 'tools')
  assert.equal(toolFolderPath('deal-pipeline'), 'tools/deal-pipeline')
  assert.equal(toolIndexPath('deal-pipeline'), 'tools/deal-pipeline/index.md')
  assert.equal(toolUiPath('deal-pipeline'), 'tools/deal-pipeline/ui.md')
  assert.equal(toolDataPath('deal-pipeline'), 'tools/deal-pipeline/data.md')
})

test('TOOL_NAME_RE takes url-safe lower-case names only', () => {
  for (const good of ['a', 'deal-pipeline', '9-lives', 'a'.repeat(63)]) {
    assert.ok(TOOL_NAME_RE.test(good), good)
  }
  for (const bad of ['', 'Deal', 'deal_pipeline', '-deal', 'deal pipeline', 'deal.pipeline', 'a'.repeat(64)]) {
    assert.equal(TOOL_NAME_RE.test(bad), false, bad)
  }
})

test('toolNameOfPath names the tool a path belongs to, or nothing', () => {
  assert.equal(toolNameOfPath('tools/deal-pipeline/index.md'), 'deal-pipeline')
  assert.equal(toolNameOfPath('tools/deal-pipeline/ui.md'), 'deal-pipeline')
  assert.equal(toolNameOfPath('/tools/deal-pipeline/data.md'), 'deal-pipeline')
  assert.equal(toolNameOfPath('tools/deal-pipeline/notes/scratch.md'), 'deal-pipeline')
  for (const outside of [
    'tools/index.md',
    'tools/loose-note.md',
    'tools',
    'tools/Deal Pipeline/index.md',
    'tools/deal_pipeline/index.md',
    'connectors/hubspot.md',
    'people/ana/index.md',
  ]) {
    assert.equal(toolNameOfPath(outside), null, outside)
  }
})

test('toolFileKindOfPath tells the store which file it is looking at', () => {
  assert.equal(toolFileKindOfPath('tools/deal-pipeline/index.md'), 'index')
  assert.equal(toolFileKindOfPath('tools/deal-pipeline/ui.md'), 'ui')
  assert.equal(toolFileKindOfPath('tools/deal-pipeline/data.md'), 'data')
  assert.equal(toolFileKindOfPath('tools/deal-pipeline/notes/scratch.md'), 'other')
  assert.equal(toolFileKindOfPath('tools/index.md'), 'other', 'the namespace index belongs to no tool')
  assert.equal(toolFileKindOfPath('tools'), 'other')
  assert.equal(toolFileKindOfPath('people/ana/index.md'), null, 'null is the not-my-business answer')
  assert.equal(toolFileKindOfPath('toolsy/x.md'), null)
})

test('isToolPath covers the whole namespace', () => {
  assert.ok(isToolPath('tools/deal-pipeline/index.md'))
  assert.ok(isToolPath('tools/index.md'))
  assert.ok(isToolPath('tools'))
  assert.equal(isToolPath('toolsy/x.md'), false)
  assert.equal(isToolPath('agents/digest.md'), false)
})

// ── source wrapping ──

test('the source files carry the names their authors use', () => {
  assert.deepEqual(TOOL_SOURCE_FILES.ui, { path: 'ui.md', authorName: 'ui.tsx', lang: 'tsx' })
  assert.deepEqual(TOOL_SOURCE_FILES.data, { path: 'data.md', authorName: 'data.js', lang: 'js' })
})

test('wrapSource writes a source note that unwraps to the same code', () => {
  const code = `export default function Tool() {\n  return <div className="p-4">hi</div>\n}`
  const md = wrapSource(code, 'tsx')
  const fm = parseFrontmatter(md)
  assert.equal(fm.type, 'tool-source')
  assert.equal(fm.lang, 'tsx')
  assert.deepEqual(unwrapSource(md), { code, lang: 'tsx' })
})

test('code containing its own ``` fences survives the round trip', () => {
  const code = [
    'const docs = `',
    '```js',
    'const x = 1',
    '```',
    '`',
    'export default () => docs',
  ].join('\n')
  const md = wrapSource(code, 'js')
  assert.match(md, /^````js$/m, 'the fence outgrows the longest run inside')
  assert.deepEqual(unwrapSource(md), { code, lang: 'js' })
})

test('a four-backtick run inside pushes the fence out further still', () => {
  const code = 'const s = "````"'
  const md = wrapSource(code, 'js')
  assert.match(md, /^`````js$/m)
  assert.deepEqual(unwrapSource(md), { code, lang: 'js' })
})

test('wrapping is idempotent through a round trip, trailing blank lines aside', () => {
  const code = 'const a = 1\n\n\n'
  const once = wrapSource(code, 'js')
  const unwrapped = unwrapSource(once)
  assert.equal(unwrapped?.code, 'const a = 1')
  assert.equal(wrapSource(unwrapped?.code ?? '', 'js'), once)
})

test('empty source is a note, not a crash', () => {
  assert.deepEqual(unwrapSource(wrapSource('', 'tsx')), { code: '', lang: 'tsx' })
})

test('unwrapSource returns null for anything that is not a wrapped source', () => {
  const code = 'const a = 1'
  for (const md of [
    '',
    'const a = 1',
    `---\ntype: tool\nlang: js\n---\n\n\`\`\`js\n${code}\n\`\`\`\n`, // wrong type
    `---\ntype: tool-source\n---\n\n\`\`\`js\n${code}\n\`\`\`\n`, // no lang
    `---\ntype: tool-source\nlang: python\n---\n\n\`\`\`py\n${code}\n\`\`\`\n`, // unknown lang
    `---\ntype: tool-source\nlang: js\n---\n\nno fence here\n`,
    `---\ntype: tool-source\nlang: js\n---\n\n\`\`\`js\n${code}\n`, // never closed
  ]) {
    assert.equal(unwrapSource(md), null, JSON.stringify(md.slice(0, 40)))
  }
})

test('the frontmatter lang wins over the fence info string', () => {
  const md = `---\ntype: TOOL-SOURCE\nlang: TSX\n---\n\n\`\`\`js\nconst a = 1\n\`\`\`\n`
  assert.deepEqual(unwrapSource(md), { code: 'const a = 1', lang: 'tsx' })
})

// ── config ──

const FULL_NOTE = `---
type: tool
title: Deal Pipeline
description: Kanban over deal notes
version: 3
surfaces:
  rail: { label: Deals, icon: kanban }
  types: [{ type: Deal, mode: page }, { type: person, mode: tab }]
perimeter:
  read: ["deals/**", "people/*/index.md"]
  write: ["deals/**"]
  types: [deal]
  connectors: [hubspot]
  agents: ["deal-*"]
---

# Deal Pipeline
`

test('parseToolConfig reads a well-formed tool note', () => {
  const r = parseToolConfig(parseFrontmatter(FULL_NOTE), 'deal-pipeline')
  assert.ok(r.ok, JSON.stringify(r))
  if (!r.ok) return
  const config: ToolConfig = r.config
  assert.equal(config.name, 'deal-pipeline')
  assert.equal(config.title, 'Deal Pipeline')
  assert.equal(config.description, 'Kanban over deal notes')
  assert.equal(config.version, 3)
  assert.deepEqual(config.surfaces.rail, { label: 'Deals', icon: 'kanban' })
  const expectedTypes: ToolTypeSurface[] = [
    { type: 'deal', mode: 'page' },
    { type: 'person', mode: 'tab' },
  ]
  assert.deepEqual(config.surfaces.types, expectedTypes)
  assert.deepEqual(config.perimeter.read, ['deals/**', 'people/*/index.md'])
  assert.deepEqual(config.perimeter.connectors, ['hubspot'])
})

test('the optional fields all have a defined default', () => {
  const r = parseToolConfig({ type: 'Tool' }, 'bare')
  assert.ok(r.ok, JSON.stringify(r))
  if (!r.ok) return
  assert.equal(r.config.title, 'bare', 'a titleless tool is named after its folder')
  assert.equal(r.config.description, '')
  assert.equal(r.config.version, 0)
  assert.equal(r.config.surfaces.rail, null)
  assert.deepEqual(r.config.surfaces.types, [])
  assert.deepEqual(r.config.perimeter, {
    read: [],
    write: [],
    types: [],
    connectors: [],
    agents: [],
  })
})

test('a rail with no icon gets the default one, and no label gets the title', () => {
  const r = parseToolConfig({ type: 'tool', title: 'Deals', surfaces: { rail: {} } }, 'deals')
  assert.ok(r.ok, JSON.stringify(r))
  if (r.ok) assert.deepEqual(r.config.surfaces.rail, { label: 'Deals', icon: 'grid' })
})

test('every named rail icon is accepted', () => {
  for (const icon of TOOL_RAIL_ICONS) {
    const r = parseToolConfig({ type: 'tool', surfaces: { rail: { icon } } }, 'deals')
    assert.ok(r.ok, icon)
    if (r.ok) assert.equal(r.config.surfaces.rail?.icon, icon)
  }
})

test('a bare type name claims a tab, never a page', () => {
  const r = parseToolConfig({ type: 'tool', surfaces: { types: ['Deal'] } }, 'deals')
  assert.ok(r.ok, JSON.stringify(r))
  if (r.ok) assert.deepEqual(r.config.surfaces.types, [{ type: 'deal', mode: 'tab' }])
})

test('a tool may add a tab to a built-in type but never own its page', () => {
  for (const type of ['person', 'space', 'event', 'resource', 'section', 'channel', 'connector', 'agent', 'tool', 'index']) {
    const tab = parseToolConfig({ type: 'tool', surfaces: { types: [{ type, mode: 'tab' }] } }, 'deals')
    assert.ok(tab.ok, `${type} tab`)
    const page = parseToolConfig({ type: 'tool', surfaces: { types: [{ type, mode: 'page' }] } }, 'deals')
    assert.equal(page.ok, false, `${type} page`)
    if (!page.ok) assert.match(page.error, /may not claim `mode: page` for the built-in type/)
  }
})

test('a built-in type cannot smuggle a page in under an old spelling', () => {
  for (const type of ['community', 'organization', 'people', 'companies']) {
    const r = parseToolConfig({ type: 'tool', surfaces: { types: [{ type, mode: 'page' }] } }, 'deals')
    assert.equal(r.ok, false, type)
  }
})

test('parseToolConfig says what is wrong instead of vanishing', () => {
  const cases: [NonNullable<unknown>, string, RegExp][] = [
    [{ type: 'tool' }, 'Deal Pipeline', /is not a valid tool name/],
    [{ type: 'tool' }, 'deal_pipeline', /is not a valid tool name/],
    [{}, 'deals', /must include `type: tool`/],
    [{ type: 'agent' }, 'deals', /must include `type: tool`/],
    [{ type: 'tool', version: 1.5 }, 'deals', /`version` must be an integer/],
    [{ type: 'tool', version: -1 }, 'deals', /`version` must be an integer/],
    [{ type: 'tool', version: 'three' }, 'deals', /`version` must be an integer/],
    [{ type: 'tool', surfaces: [] }, 'deals', /`surfaces` must be a map/],
    [{ type: 'tool', surfaces: 'rail' }, 'deals', /`surfaces` must be a map/],
    [{ type: 'tool', surfaces: { rail: 'Deals' } }, 'deals', /`surfaces\.rail` must be a map/],
    [{ type: 'tool', surfaces: { rail: { label: 7 } } }, 'deals', /`surfaces\.rail\.label` must be a string/],
    [{ type: 'tool', surfaces: { rail: { icon: 'skull' } } }, 'deals', /Unknown `surfaces\.rail\.icon`/],
    [{ type: 'tool', surfaces: { types: 'deal' } }, 'deals', /`surfaces\.types` must be a list/],
    [{ type: 'tool', surfaces: { types: [{}] } }, 'deals', /Bad `surfaces\.types` entry/],
    [{ type: 'tool', surfaces: { types: [{ type: 'deal', mode: 'iframe' }] } }, 'deals', /must be page or tab/],
    [
      { type: 'tool', surfaces: { types: [{ type: 'deal' }, { type: 'Deal', mode: 'page' }] } },
      'deals',
      /claims "deal" twice/,
    ],
    [{ type: 'tool', perimeter: { read: 'deals/**' } }, 'deals', /`perimeter\.read` must be a list/],
  ]
  for (const [fm, name, expected] of cases) {
    const r = parseToolConfig(fm, name)
    assert.equal(r.ok, false, JSON.stringify([fm, name]))
    if (!r.ok) assert.match(r.error, expected)
  }
})

// ── the starter note ──

test('newToolIndexNote writes a note that parses back', () => {
  const md = newToolIndexNote({
    name: 'deal-pipeline',
    title: 'Deal Pipeline',
    description: 'Kanban over deal notes',
  })
  const r = parseToolConfig(parseFrontmatter(md), 'deal-pipeline')
  assert.ok(r.ok, JSON.stringify(r))
  if (!r.ok) return
  assert.equal(r.config.title, 'Deal Pipeline')
  assert.equal(r.config.description, 'Kanban over deal notes')
  assert.equal(r.config.version, 0)
  assert.equal(r.config.surfaces.rail, null)
  assert.deepEqual(r.config.surfaces.types, [])
  assert.deepEqual(r.config.perimeter.read, [], 'a new tool reaches nothing until it says so')

  assert.match(md, /^# Deal Pipeline$/m, 'the index contract wants an H1 title')
  assert.match(md, /^## How it works$/m)
  assert.match(md, /ui\.tsx/)
  assert.match(md, /data\.js/)
  assert.ok(!md.includes('|'), 'index notes carry prose and bullets, not tables')
})

test('a starter note with no title or description still parses', () => {
  const md = newToolIndexNote({ name: 'scratch' })
  const r = parseToolConfig(parseFrontmatter(md), 'scratch')
  assert.ok(r.ok, JSON.stringify(r))
  if (r.ok) {
    assert.equal(r.config.title, 'scratch')
    assert.equal(r.config.description, '')
  }
  assert.match(md, /^# scratch$/m)
})

// ── marketplace metadata: `tags:` and `preview:` (ticket 4.1) ────────────────

test('tags are lower-cased, de-duplicated and capped at TOOL_TAGS_MAX', () => {
  const r = parseToolConfig({ type: 'tool', tags: ['CRM', 'crm', ' kanban '] }, 'deals')
  assert.ok(r.ok)
  assert.deepEqual(r.config.tags, ['crm', 'kanban'])
  // A bare string is one tag — `tags: crm` is what people write.
  const one = parseToolConfig({ type: 'tool', tags: 'crm' as unknown as string[] }, 'deals')
  assert.ok(one.ok)
  assert.deepEqual(one.config.tags, ['crm'])
  // Absent means none, not an error.
  const none = parseToolConfig({ type: 'tool' }, 'deals')
  assert.ok(none.ok)
  assert.deepEqual(none.config.tags, [])
  assert.equal(none.config.previewUrl, null)

  const nine = parseToolConfig({ type: 'tool', tags: Array.from({ length: TOOL_TAGS_MAX + 1 }, (_, i) => `t${i}`) }, 'deals')
  assert.ok(!nine.ok)
  assert.match(nine.error, /Too many `tags`/)
})

test('a tag is short, lower-case, hyphenated — or refused with the rule', () => {
  for (const bad of ['has space', 'UPPER_CASE_underscore', 'x'.repeat(25), 7, '']) {
    const r = parseToolConfig({ type: 'tool', tags: [bad] as unknown as string[] }, 'deals')
    assert.ok(!r.ok, String(bad))
    assert.match(r.error, /Bad tag|tags are strings/)
  }
})

test('preview accepts a same-origin media path and nothing else — not even https', () => {
  for (const good of ['/api/media/abc123.png', '/api/media/x/y.jpg?v=2']) {
    const r = parseToolConfig({ type: 'tool', preview: good }, 'deals')
    assert.ok(r.ok, good)
    assert.equal(r.config.previewUrl, good)
  }
  for (const bad of [
    // A third-party host would see every marketplace visitor's IP.
    'https://cdn.example.com/shot.png',
    'http://cdn.example.com/shot.png',
    'https://visvine.com/api/media/abc.png',
    'data:image/png;base64,AAAA',
    'javascript:alert(1)',
    'shot.png',
    '/uploads/shot.png',
    { url: 'x' },
  ]) {
    const r = parseToolConfig({ type: 'tool', preview: bad }, 'deals')
    assert.ok(!r.ok, JSON.stringify(bad))
    assert.match(r.error, /`preview`/)
  }
})

test('newToolIndexNote can scaffold a rail row from a label', () => {
  const md = newToolIndexNote({ name: 'deals', title: 'Deals', railLabel: 'Deals' })
  const r = parseToolConfig(parseFrontmatter(md), 'deals')
  assert.ok(r.ok)
  assert.deepEqual(r.config.surfaces.rail, { label: 'Deals', icon: 'grid' })
  const plain = parseToolConfig(parseFrontmatter(newToolIndexNote({ name: 'deals' })), 'deals')
  assert.ok(plain.ok)
  assert.equal(plain.config.surfaces.rail, null)
})
