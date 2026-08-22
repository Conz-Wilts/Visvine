// A hand-made `tools/<name>/index.md` — anything that isn't
// lib/tools/service.ts#createTool, which makes the `tool:<name>` node BEFORE
// writing the note — used to lose `type: tool` silently: a Tool is
// folder-only (lib/notes/entities.ts FOLDER_ONLY_ENTITY_KINDS), so its entity
// note is always the index path, and store.ts#enforceIndexContract held that
// to the entity contract only when a node already backed it. With no node,
// the contract fell back to the plain Index shape and the config note stopped
// parsing.
//
// The fix (lib/notes/entityLinks.ts#ensureToolNode, wired into
// store.ts#enforceIndexContract) is DB-backed — it creates the node, or
// throws a denial when the name is claimed elsewhere — so it can't be driven
// end-to-end here without a live Postgres (this suite, like the rest of
// tests/*.test.ts, runs with none). What's tested instead is the pure
// decision surface those two functions are built on: given the DB facts they
// would have looked up, does the write end up parseable by parseToolConfig,
// or refused with a message that names createTool? That's exactly the
// contract enforceIndexContract and ensureToolNode hold each other to.
//
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-entity-folder.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  declaredFolderOnlyEntity,
  enforceIndexFrontmatter,
  entityNameClashDenial,
} from '../lib/notes/shared/indexNote'
import { parseFrontmatter } from '../lib/notes/shared/markdown'
import { newToolIndexNote, parseToolConfig, toolFileKindOfPath, toolNameOfPath } from '../lib/tools/config'

const NAME = 'deal-pipeline'
const INDEX_PATH = `tools/${NAME}/index.md`

test('declaredFolderOnlyEntity recognises a write that claims to be a tool', () => {
  const fm = parseFrontmatter('---\ntype: tool\ntitle: Deal Pipeline\ndescription: Kanban over deals\n---\n')
  assert.deepEqual(declaredFolderOnlyEntity(fm, 'tool', NAME), {
    name: 'Deal Pipeline',
    subtitle: 'Kanban over deals',
  })
})

test('declaredFolderOnlyEntity falls back to the path-derived name and no subtitle', () => {
  const fm = parseFrontmatter('---\ntype: tool\n---\n')
  assert.deepEqual(declaredFolderOnlyEntity(fm, 'tool', NAME), { name: NAME, subtitle: null })
})

test('declaredFolderOnlyEntity is null for anything that is not claiming the kind', () => {
  // Never written at all (a brand-new plain index).
  assert.equal(declaredFolderOnlyEntity(parseFrontmatter(''), 'tool', NAME), null)
  // A plain folder index, or an index note that lost its type already.
  assert.equal(declaredFolderOnlyEntity(parseFrontmatter('---\ntype: Index\n---\n'), 'tool', NAME), null)
  // A different entity kind at a tool-shaped path (nonsensical, but must not
  // be read as "yes").
  assert.equal(declaredFolderOnlyEntity(parseFrontmatter('---\ntype: Person\n---\n'), 'tool', NAME), null)
})

test('toolFileKindOfPath/toolNameOfPath gate which writes even reach the decision', () => {
  // Only a path shaped like a Tool's own index, with a TOOL_NAME_RE-legal
  // folder, is a candidate — this is the same gate ensureToolNode applies
  // before it ever asks declaredFolderOnlyEntity anything.
  assert.equal(toolFileKindOfPath(INDEX_PATH), 'index')
  assert.equal(toolNameOfPath(INDEX_PATH), NAME)
  assert.equal(toolFileKindOfPath('tools/Deal Pipeline/index.md'), 'other')
  assert.equal(toolNameOfPath('tools/Deal Pipeline/index.md'), null)
  assert.equal(toolFileKindOfPath('tools/deal-pipeline/ui.md'), 'ui')
})

test('once a node backs it, the write ends up parseable by parseToolConfig', () => {
  // What a hand-made create-note / REST / MCP / restore write looks like:
  // straight `type: tool` frontmatter, no `node:` yet, because nothing made
  // the node first.
  const written = newToolIndexNote({ name: NAME, title: 'Deal Pipeline', description: 'Kanban over deals' })
  const intent = declaredFolderOnlyEntity(parseFrontmatter(written), 'tool', NAME)
  assert.ok(intent)

  // This is what enforceIndexContract does once ensureToolNode has created
  // (or found) the node: hold the note to the contract WITH its entity, which
  // is what stamps the `node:` back-pointer on.
  const held = enforceIndexFrontmatter(written, `tools/${NAME}`, {
    typeLabel: 'tool',
    nodeId: `tool:${NAME}`,
    name: intent!.name,
  })

  const heldFm = parseFrontmatter(held)
  const parsed = parseToolConfig(heldFm, NAME)
  assert.equal(parsed.ok, true)
  if (parsed.ok) {
    assert.equal(parsed.config.title, 'Deal Pipeline')
    assert.equal(parsed.config.description, 'Kanban over deals')
  }
  assert.equal(heldFm.type, 'tool')
  assert.equal((heldFm as Record<string, unknown>).node, `tool:${NAME}`)
})

test('without a node the config survives — it just has no back-pointer', () => {
  // A write that never resolves a node (only reachable in a personal context;
  // a shared write gets one from ensureToolNode). The type is the note's own
  // statement of what it is, so the contract leaves it alone — what is missing
  // is the `node:`, and that is what says a real Tool stands behind it.
  const written = newToolIndexNote({ name: NAME, title: 'Deal Pipeline' })
  const plain = enforceIndexFrontmatter(written, `tools/${NAME}`)
  const fm = parseFrontmatter(plain)
  assert.equal(fm.type, 'tool')
  assert.equal((fm as Record<string, unknown>).node, undefined)
  assert.equal(parseToolConfig(fm, NAME).ok, true)
})

test('a name claimed by another space is refused with a message naming createTool', () => {
  const denial = entityNameClashDenial(NAME, 'tool', 'lib/tools/service.ts#createTool')
  assert.match(denial, new RegExp(`"${NAME}"`))
  assert.match(denial, /createTool/)
})

test('an ordinary folder index (no type: tool claim) is untouched by the tool contract', () => {
  const plain = '---\ntitle: Deals\n---\n\nJust a folder.\n'
  assert.equal(declaredFolderOnlyEntity(parseFrontmatter(plain), 'tool', NAME), null)
  // Byte-identical: a folder that says nothing about its subject is left saying
  // nothing. The path is what makes it a folder.
  assert.equal(enforceIndexFrontmatter(plain, `tools/${NAME}`), plain)
})
