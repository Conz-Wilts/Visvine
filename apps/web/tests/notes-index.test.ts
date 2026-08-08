// Unit tests for the per-folder index-note helpers (lib/notes/shared/indexNote):
// path derivation and the auto-created stub content.
// Run: node --import tsx --test tests/notes-index.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CHILDREN_CLOSE,
  CHILDREN_OPEN,
  INDEX_BASENAME,
  ancestorFolders,
  applyChildrenBlock,
  buildIndexStub,
  folderOfIndexPath,
  hasChildrenBlock,
  humanizeFolderName,
  indexFolderPathOf,
  indexPathOf,
  isIndexContent,
  isIndexPath,
  newIndexContent,
  nextIndexTitle,
} from '../lib/notes/shared/indexNote'
import { parseFrontmatter, splitFrontmatter } from '../lib/notes/shared/markdown'

test('isIndexPath / indexPathOf round-trip', () => {
  assert.equal(isIndexPath('people/index.md'), true)
  assert.equal(isIndexPath('index.md'), true)
  assert.equal(isIndexPath('people/index-fund.md'), false)
  assert.equal(isIndexPath('people/craig.md'), false)
  assert.equal(indexPathOf('people'), 'people/index.md')
  assert.equal(isIndexPath(indexPathOf('a/b')), true)
})

test('ancestorFolders lists ancestors shallowest-first, excluding root', () => {
  assert.deepEqual(ancestorFolders('a/b/c.md'), ['a', 'a/b'])
  assert.deepEqual(ancestorFolders('people/craig.md'), ['people'])
  assert.deepEqual(ancestorFolders('welcome.md'), [])
})

test('humanizeFolderName title-cases dashed/underscored segments', () => {
  assert.equal(humanizeFolderName('portfolio-companies'), 'Portfolio Companies')
  assert.equal(humanizeFolderName('deal_flow'), 'Deal Flow')
  assert.equal(humanizeFolderName('people'), 'People')
})

test('buildIndexStub emits Index frontmatter and a sorted linked list', () => {
  const stub = buildIndexStub('people', [
    { path: 'people/zoe.md', title: 'Zoe' },
    { path: 'people/craig-piggott.md', title: 'Craig Piggott' },
  ])
  const fm = parseFrontmatter(stub)
  assert.equal(fm.type, 'Index')
  assert.equal(fm.title, 'People')
  const { body } = splitFrontmatter(stub)
  assert.deepEqual(body.trim().split('\n'), [
    CHILDREN_OPEN,
    '- [Craig Piggott](/people/craig-piggott.md)',
    '- [Zoe](/people/zoe.md)',
    CHILDREN_CLOSE,
  ])
})

test('buildIndexStub for an empty folder has an empty managed block', () => {
  const stub = buildIndexStub('deals/2026', [])
  assert.equal(parseFrontmatter(stub).title, '2026')
  assert.equal(splitFrontmatter(stub).body.trim(), `${CHILDREN_OPEN}\n${CHILDREN_CLOSE}`)
})

// The type is what makes a note an index — the path follows it, not the reverse.
test('isIndexContent reads the declared type, case-insensitively', () => {
  assert.equal(isIndexContent('---\ntype: Index\n---\n\nhi\n'), true)
  assert.equal(isIndexContent('---\ntype: index\n---\n'), true)
  assert.equal(isIndexContent('---\ntype: Note\n---\n'), false)
  assert.equal(isIndexContent('no frontmatter at all'), false)
})

test('indexFolderPathOf / folderOfIndexPath name the folder a note becomes', () => {
  assert.equal(indexFolderPathOf('data/research.md'), 'data/research')
  assert.equal(indexFolderPathOf('research.md'), 'research')
  assert.equal(folderOfIndexPath('data/research/index.md'), 'data/research')
  assert.equal(folderOfIndexPath('index.md'), '')
  assert.equal(indexPathOf(''), 'index.md')
})

// --- the managed child block -------------------------------------------------

const CHILDREN = [
  { path: 'people/zoe.md', title: 'Zoe' },
  { path: 'people/craig.md', title: 'Craig' },
]

test('applyChildrenBlock appends a block to a body that has none', () => {
  const before = '---\ntype: Index\ntitle: People\n---\n\n# People\n\nWho we back.\n'
  const after = applyChildrenBlock(before, CHILDREN)
  assert.ok(after.startsWith(before.trimEnd()), 'curated prose is preserved verbatim')
  assert.ok(hasChildrenBlock(after))
  assert.equal(parseFrontmatter(after).title, 'People')
  assert.match(after, /- \[Craig\]\(\/people\/craig\.md\)\n- \[Zoe\]\(\/people\/zoe\.md\)/)
})

test('applyChildrenBlock replaces an existing block in place, leaving prose alone', () => {
  const first = applyChildrenBlock('---\ntype: Index\n---\n\nWho we back.\n', CHILDREN)
  const second = applyChildrenBlock(first, [{ path: 'people/ann.md', title: 'Ann' }])
  assert.ok(second.includes('Who we back.'))
  assert.ok(second.includes('- [Ann](/people/ann.md)'))
  assert.ok(!second.includes('Zoe'))
  assert.equal(second.split(CHILDREN_OPEN).length - 1, 1, 'exactly one managed block')
})

// A curated index that walks through its own contents keeps that writing; the
// block only picks up what the prose hasn't already introduced.
test('applyChildrenBlock leaves out children the curated prose already links', () => {
  const curated = '---\ntype: Index\n---\n\n- [Zoe](/people/zoe.md) — leads the seed fund\n'
  const after = applyChildrenBlock(curated, CHILDREN)
  assert.ok(after.includes('leads the seed fund'))
  assert.ok(after.includes('- [Craig](/people/craig.md)'))
  assert.equal(
    after.slice(after.indexOf(CHILDREN_OPEN)).includes('zoe.md'),
    false,
    'already linked above — not repeated in the block',
  )
})

test('a fully curated index grows an empty block, not a duplicate list', () => {
  const curated =
    '---\ntype: Index\n---\n\n- [Craig](/people/craig.md)\n- [Zoe](/people/zoe.md)\n'
  const after = applyChildrenBlock(curated, CHILDREN)
  assert.ok(after.endsWith(`${CHILDREN_OPEN}\n${CHILDREN_CLOSE}\n`))
})

test('applyChildrenBlock is a no-op when nothing changed — callers skip the write', () => {
  const once = applyChildrenBlock('---\ntype: Index\n---\n\nProse.\n', CHILDREN)
  assert.equal(applyChildrenBlock(once, CHILDREN), once)
})

test('applyChildrenBlock keeps trailing prose below the block on a refresh', () => {
  const before = `---\ntype: Index\n---\n\nAbove.\n\n${CHILDREN_OPEN}\n${CHILDREN_CLOSE}\n\nBelow.\n`
  const after = applyChildrenBlock(before, CHILDREN)
  assert.ok(after.includes('Above.'))
  assert.ok(after.endsWith('Below.\n'))
})

test('newIndexContent is an Index note with an empty block ready to fill', () => {
  const content = newIndexContent({ title: 'Research', tags: ['deals'], body: 'Live work.' })
  assert.equal(parseFrontmatter(content).type, 'Index')
  assert.equal(parseFrontmatter(content).title, 'Research')
  assert.equal(isIndexContent(content), true)
  assert.ok(content.includes('# Research'))
  assert.ok(content.includes('Live work.'))
  assert.equal(hasChildrenBlock(content), true)
})

// A folder's display name IS its index title, so a path rename may not walk
// over a name somebody chose.
test('nextIndexTitle follows a rename only while the title is untouched', () => {
  // Never named: the title is whatever the old segment produced (or blank, or
  // the bare segment) — it follows the new path.
  assert.equal(nextIndexTitle('deal-flow', 'pipeline', 'Deal Flow'), 'Pipeline')
  assert.equal(nextIndexTitle('deal-flow', 'pipeline', 'deal-flow'), 'Pipeline')
  assert.equal(nextIndexTitle('deal-flow', 'pipeline', ''), 'Pipeline')
  assert.equal(nextIndexTitle('deal-flow', 'pipeline', null), 'Pipeline')
})

test('nextIndexTitle keeps a curated folder name across a rename', () => {
  // communities/ named "Companies" stays Companies when the path moves.
  assert.equal(nextIndexTitle('communities', 'portfolio', 'Companies'), null)
})

test('INDEX_BASENAME is the canonical filename', () => {
  assert.equal(INDEX_BASENAME, 'index.md')
})
