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
  parseChildrenBlock,
  reattachChildrenBlock,
  splitChildrenBlock,
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

// the managed child block

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

// The editor's side of the managed block: it is machine-owned text, and the
// WYSIWYG surface renders HTML comments literally, so the block is split off
// before the body reaches the editor and put back on the way out.
test('splitChildrenBlock takes the block out and reattach puts it back', () => {
  const block = `${CHILDREN_OPEN}\n- [Zoe](/people/zoe.md)\n${CHILDREN_CLOSE}`
  const body = `Who we back.\n\n${block}\n`
  const split = splitChildrenBlock(body)
  assert.equal(split.body, 'Who we back.')
  assert.equal(split.block, block)
  assert.equal(hasChildrenBlock(split.body), false)
  assert.equal(reattachChildrenBlock(split.body, split.block), body)
})

test('splitChildrenBlock leaves a body that has no block alone', () => {
  const body = 'Just a note.\n'
  const split = splitChildrenBlock(body)
  assert.equal(split.block, null)
  assert.equal(split.body, body)
  assert.equal(reattachChildrenBlock(body, null), body)
})

test('an emptied index body keeps its block, without a leading blank run', () => {
  const empty = `${CHILDREN_OPEN}\n${CHILDREN_CLOSE}`
  assert.equal(splitChildrenBlock(`${empty}\n`).body, '')
  assert.equal(reattachChildrenBlock('', empty), `${empty}\n`)
})

test('parseChildrenBlock reads back exactly what renderChildrenBlock wrote', () => {
  const listed = applyChildrenBlock('---\ntype: Index\n---\n\n', [
    { path: 'people/zoe.md', title: 'Zoe' },
    { path: 'people/ann.md', title: 'Ann' },
  ])
  assert.deepEqual(parseChildrenBlock(splitChildrenBlock(listed).block), [
    { path: 'people/ann.md', title: 'Ann' },
    { path: 'people/zoe.md', title: 'Zoe' },
  ])
  assert.deepEqual(parseChildrenBlock(null), [])
  // A block somebody hand-mangled loses the bad rows, not the good ones.
  assert.deepEqual(
    parseChildrenBlock(`${CHILDREN_OPEN}\nloose text\n- [Ann](/people/ann.md)\n${CHILDREN_CLOSE}`),
    [{ path: 'people/ann.md', title: 'Ann' }],
  )
})

// The BRAIN ROOT's index — the space home page the Directory's Context tab
// routes to. Seeded by ensureRootIndex (lib/notes/store.ts) at space
// creation; these pin the contract that helper leans on.
test('the root index path is the bare basename, and declares itself an Index', () => {
  assert.equal(indexPathOf(''), INDEX_BASENAME)
  assert.equal(isIndexPath(INDEX_BASENAME), true)

  // What ensureRootIndex writes must satisfy the repo's own note invariant
  // (scripts/verify-notes-rules.ts: an index.md must declare `type: Index`),
  // and carry a children block so the root opts in to auto-listing — a root
  // WITHOUT one is deliberately left alone by refreshFolderIndex.
  const content = newIndexContent({ title: "Connor's Space" })
  assert.equal(parseFrontmatter(content).type, 'Index')
  assert.equal(parseFrontmatter(content).title, "Connor's Space")
  assert.equal(hasChildrenBlock(content), true)
})

test('no ancestor walk can create the root index — hence ensureRootIndex', () => {
  // ancestorFolders excludes the brain root, so ensureAncestorIndexes (which
  // iterates exactly this list) can never seed 'index.md'. That gap is the
  // whole reason ensureRootIndex exists; if this ever returns [''], the root
  // would be created twice by two different paths.
  assert.deepEqual(ancestorFolders(INDEX_BASENAME), [])
  assert.deepEqual(ancestorFolders('welcome.md'), [])
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
