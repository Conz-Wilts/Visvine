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
  enforceIndexFrontmatter,
  folderOfIndexPath,
  hasChildrenBlock,
  humanizeFolderName,
  indexFolderPathOf,
  indexPathOf,
  declaresIndexType,
  displayTypeOf,
  INDEX_DISPLAY_TYPE,
  isIndexPath,
  newIndexContent,
  nextIndexTitle,
  foldCuratedChildren,
  normalizeIndexNote,
  parseChildrenBlock,
  pluralizeType,
  reattachChildrenBlock,
  splitChildrenBlock,
  stripDuplicateTitleHeading,
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

test('buildIndexStub emits a titled folder note and a sorted linked list', () => {
  const stub = buildIndexStub('people', [
    { path: 'people/zoe.md', title: 'Zoe' },
    { path: 'people/craig-piggott.md', title: 'Craig Piggott' },
  ])
  const fm = parseFrontmatter(stub)
  // No type: a generated folder note says nothing about a subject nobody chose.
  assert.equal(fm.type, undefined)
  assert.equal(fm.title, 'People')
  const { body } = splitFrontmatter(stub)
  // The OKF index shape: a section heading, then `* [Title](relative) - desc`.
  assert.deepEqual(body.trim().split('\n'), [
    CHILDREN_OPEN,
    '## Notes',
    '',
    '* [Craig Piggott](craig-piggott.md)',
    '* [Zoe](zoe.md)',
    CHILDREN_CLOSE,
  ])
})

test('buildIndexStub for an empty folder has an empty managed block', () => {
  const stub = buildIndexStub('deals/2026', [])
  assert.equal(parseFrontmatter(stub).title, '2026')
  assert.equal(splitFrontmatter(stub).body.trim(), `${CHILDREN_OPEN}\n${CHILDREN_CLOSE}`)
})

// The contract at an index path: a title, and nothing about the shape. The
// path already says it is a folder, so `type:` is left to mean the subject.
test('enforceIndexFrontmatter keeps a declared type — that is the subject', () => {
  const written =
    '---\ntype: Playbook\ntitle: Blackbird Portfolio Companies\ndescription: Master index\n---\n\n# Portfolio\n\nprose\n'
  assert.equal(enforceIndexFrontmatter(written, 'spaces'), written)
})

test('enforceIndexFrontmatter strips type: Index — a folder is a path, not a type', () => {
  const fixed = enforceIndexFrontmatter('---\ntype: Index\ntitle: People\ntags: [a]\n---\n\nbody\n', 'people')
  const fm = parseFrontmatter(fixed)
  assert.equal(fm.type, undefined)
  assert.equal(fm.title, 'People')
  assert.deepEqual(fm.tags, ['a'])
  assert.ok(splitFrontmatter(fixed).body.includes('body'))
})

test('enforceIndexFrontmatter falls back to the folder display name for a missing title', () => {
  const fixed = enforceIndexFrontmatter('just a body, no frontmatter\n', 'deal-flow')
  const fm = parseFrontmatter(fixed)
  assert.equal(fm.type, undefined)
  assert.equal(fm.title, 'Deal Flow')
  assert.ok(splitFrontmatter(fixed).body.includes('just a body'))
})

test('enforceIndexFrontmatter is a byte no-op on conforming content', () => {
  // A folder the space made: title only, and nothing added. (A reserved
  // namespace does gain the one line saying what it holds — see below.)
  const untyped = '---\ntitle: Deals\n---\n\nbody\n'
  assert.equal(enforceIndexFrontmatter(untyped, 'deals'), untyped)
})

// Nothing acts on the word any more; the guard exists to keep it out of storage.
test('declaresIndexType reads the declared type, case-insensitively', () => {
  assert.equal(declaresIndexType('---\ntype: Index\n---\n\nhi\n'), true)
  assert.equal(declaresIndexType('---\ntype: index\n---\n'), true)
  assert.equal(declaresIndexType('---\ntype: Note\n---\n'), false)
  assert.equal(declaresIndexType('no frontmatter at all'), false)
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
  const before = '---\ntitle: People\n---\n\n# People\n\nWho we back.\n'
  const after = applyChildrenBlock(before, CHILDREN, 'people')
  assert.ok(after.startsWith(before.trimEnd()), 'curated prose is preserved verbatim')
  assert.ok(hasChildrenBlock(after))
  assert.equal(parseFrontmatter(after).title, 'People')
  assert.match(after, /\* \[Craig\]\(craig\.md\)\n\* \[Zoe\]\(zoe\.md\)/)
})

test('applyChildrenBlock replaces an existing block in place, leaving prose alone', () => {
  const first = applyChildrenBlock('---\ntitle: People\n---\n\nWho we back.\n', CHILDREN, 'people')
  const second = applyChildrenBlock(first, [{ path: 'people/ann.md', title: 'Ann' }], 'people')
  assert.ok(second.includes('Who we back.'))
  assert.ok(second.includes('* [Ann](ann.md)'))
  assert.ok(!second.includes('Zoe'))
  assert.equal(second.split(CHILDREN_OPEN).length - 1, 1, 'exactly one managed block')
})

// The block is the folder's listing, whole: prose that mentions a child does
// not take it out of the list, so deleting the note removes it from the index
// without anyone editing prose.
test('applyChildrenBlock lists every child, whatever the prose already links', () => {
  const curated = '---\ntitle: People\n---\n\nZoe ([here](/people/zoe.md)) leads the seed fund.\n'
  const after = applyChildrenBlock(curated, CHILDREN, 'people')
  assert.ok(after.includes('leads the seed fund'))
  const block = after.slice(after.indexOf(CHILDREN_OPEN))
  assert.ok(block.includes('* [Craig](craig.md)'))
  assert.ok(block.includes('* [Zoe](zoe.md)'))
})

// Sub-folders lead under `Subdirectories`, then a section per type (alphabetical),
// then whatever carries no type at all — the OKF listing, with the descriptions
// the children declared.
test('the block sections the listing: sub-folders, then types, then untyped', () => {
  const after = applyChildrenBlock('---\ntitle: Home\n---\n\n', [
    { path: 'thesis.md', title: 'Investment thesis', description: 'what we look for' },
    { path: 'team/index.md', title: 'Team', folder: true, description: 'who covers\n  what' },
    { path: 'data/index.md', title: 'Data', folder: true },
    { path: 'about.md', title: 'About' },
    { path: 'ann.md', title: 'Ann', type: 'Person', description: 'runs ops' },
    { path: 'halter/index.md', title: 'Halter', folder: true, type: 'Company' },
  ])
  assert.deepEqual(splitFrontmatter(after).body.trim().split('\n'), [
    CHILDREN_OPEN,
    '## Subdirectories',
    '',
    '* [Data](data/index.md)',
    '* [Team](team/index.md) - who covers what',
    '',
    '## Companies',
    '',
    '* [Halter](halter/index.md)',
    '',
    '## People',
    '',
    '* [Ann](ann.md) - runs ops',
    '',
    '## Notes',
    '',
    '* [About](about.md)',
    '* [Investment thesis](thesis.md) - what we look for',
    CHILDREN_CLOSE,
  ])
})

test('pluralizeType labels a section without mangling a producer-chosen type', () => {
  assert.equal(pluralizeType('Person'), 'People')
  assert.equal(pluralizeType('Company'), 'Companies')
  assert.equal(pluralizeType('BigQuery Table'), 'BigQuery Tables')
  assert.equal(pluralizeType('Metrics'), 'Metrics')
  assert.equal(pluralizeType(''), 'Notes')
})

test('applyChildrenBlock is a no-op when nothing changed — callers skip the write', () => {
  const once = applyChildrenBlock('---\ntitle: People\n---\n\nProse.\n', CHILDREN, 'people')
  assert.equal(applyChildrenBlock(once, CHILDREN, 'people'), once)
})

test('applyChildrenBlock moves a block found mid-body to the end', () => {
  const before = `---\ntitle: People\n---\n\nAbove.\n\n${CHILDREN_OPEN}\n${CHILDREN_CLOSE}\n\nBelow.\n`
  const after = applyChildrenBlock(before, CHILDREN, 'people')
  assert.ok(after.includes('Above.\n\nBelow.\n\n' + CHILDREN_OPEN))
  assert.ok(after.endsWith(`${CHILDREN_CLOSE}\n`))
})

test('newIndexContent seeds a folder home page with an empty block ready to fill', () => {
  const content = newIndexContent({ title: 'Research', tags: ['deals'], body: 'Live work.' })
  assert.equal(parseFrontmatter(content).type, undefined)
  assert.equal(parseFrontmatter(content).title, 'Research')
  assert.equal(declaresIndexType(content), false)
  assert.ok(!content.includes('# Research'), 'the title renders from frontmatter, never as a body heading')
  assert.ok(content.includes('Live work.'))
  assert.equal(hasChildrenBlock(content), true)
})

// The editor's side of the managed block: it is machine-owned text, and the
// WYSIWYG surface renders HTML comments literally, so the block is split off
// before the body reaches the editor and put back on the way out.
test('splitChildrenBlock takes the block out and reattach puts it back', () => {
  const block = `${CHILDREN_OPEN}\n* [Zoe](zoe.md)\n${CHILDREN_CLOSE}`
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
  const listed = applyChildrenBlock('---\ntitle: People\n---\n\n', [
    { path: 'people/zoe.md', title: 'Zoe' },
    { path: 'people/ann.md', title: 'Ann' },
  ], 'people')
  assert.deepEqual(parseChildrenBlock(splitChildrenBlock(listed).block, 'people'), [
    { path: 'people/ann.md', title: 'Ann', description: null, folder: false, section: 'Notes' },
    { path: 'people/zoe.md', title: 'Zoe', description: null, folder: false, section: 'Notes' },
  ])
  // A block an older build wrote — `-` bullets, absolute hrefs, an em dash —
  // still reads back whole.
  assert.deepEqual(
    parseChildrenBlock(`${CHILDREN_OPEN}\n- [Ann](/people/ann.md) — runs ops\n${CHILDREN_CLOSE}`, 'people'),
    [{ path: 'people/ann.md', title: 'Ann', description: 'runs ops', folder: false, section: 'Notes' }],
  )
  assert.deepEqual(parseChildrenBlock(null), [])
  // A block somebody hand-mangled loses the bad rows, not the good ones.
  assert.deepEqual(
    parseChildrenBlock(`${CHILDREN_OPEN}\nloose text\n* [Ann](ann.md)\n${CHILDREN_CLOSE}`, 'people'),
    [{ path: 'people/ann.md', title: 'Ann', description: null, folder: false, section: 'Notes' }],
  )
})

// The CONTEXT ROOT's index — the space home page the Directory's Context tab
// routes to. Seeded by ensureRootIndex (lib/notes/store.ts) at space
// creation; these pin the contract that helper leans on.
test('the root index path is the bare basename, and names the context', () => {
  assert.equal(indexPathOf(''), INDEX_BASENAME)
  assert.equal(isIndexPath(INDEX_BASENAME), true)

  // What ensureRootIndex writes must satisfy the repo's own note invariant
  // (scripts/verify-notes-rules.ts: an index.md carries a title, and nobody
  // declares `type: Index`), and carry a children block like every folder —
  // the root is one.
  const content = newIndexContent({ title: "Connor's Space" })
  assert.equal(parseFrontmatter(content).type, undefined)
  assert.equal(parseFrontmatter(content).title, "Connor's Space")
  assert.equal(hasChildrenBlock(content), true)
})

test('no ancestor walk can create the root index — hence ensureRootIndex', () => {
  // ancestorFolders excludes the context root, so ensureAncestorIndexes (which
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
  // spaces/ named "Companies" stays Companies when the path moves.
  assert.equal(nextIndexTitle('spaces', 'portfolio', 'Companies'), null)
})

test('INDEX_BASENAME is the canonical filename', () => {
  assert.equal(INDEX_BASENAME, 'index.md')
})

// An entity's own folder: 'people/<slug>/index.md' IS the person's note, so the
// same contract additionally holds its type and node: back-pointer.
const CONNOR = { typeLabel: 'Person', nodeId: 'person:connor', name: 'Connor' }

test('an entity folder index gets its entity type back over Index', () => {
  const fixed = enforceIndexFrontmatter(
    '---\ntype: Index\ntitle: Connor\ntags: [person]\n---\n\nbody\n',
    'people/connor',
    CONNOR,
  )
  const fm = parseFrontmatter(fixed)
  assert.equal(fm.type, 'Person')
  assert.equal(fm.title, 'Connor')
  assert.equal(fm.node, 'person:connor')
  assert.deepEqual(fm.tags, ['person'])
  assert.ok(splitFrontmatter(fixed).body.includes('body'))
})

test('an entity folder index keeps a spelling its entity accepts, and rewrites one it does not', () => {
  const halter = {
    typeLabel: 'Space',
    nodeId: 'company:halter',
    name: 'Halter',
    acceptsType: (declared: string) => ['space', 'company'].includes(declared.toLowerCase()),
  }
  // A Company record is an organisation — the word the space chose survives.
  const company = '---\ntype: Company\ntitle: Halter\nnode: company:halter\n---\n\nbody\n'
  assert.equal(enforceIndexFrontmatter(company, 'spaces/halter', halter), company)
  // A type naming something else is put back to the entity label.
  const fm = parseFrontmatter(enforceIndexFrontmatter(company.replace('Company', 'Deal'), 'spaces/halter', halter))
  assert.equal(fm.type, 'Space')
  // Index never qualifies, whatever acceptsType would say.
  const shape = parseFrontmatter(
    enforceIndexFrontmatter(company.replace('Company', 'Index'), 'spaces/halter', { ...halter, acceptsType: () => true }),
  )
  assert.equal(shape.type, 'Space')
})

// A folder the platform makes has nobody to describe it, so the contract fills
// one in — and never touches a description somebody wrote.
test('a reserved folder gets the one line saying what it holds', () => {
  const fm = parseFrontmatter(enforceIndexFrontmatter('---\ntitle: Connectors\ntags: []\n---\n\n', 'connectors'))
  assert.equal(fm.description, 'The services this space is connected to.')
  const own = '---\ntitle: Tools\ndescription: what we built for the deal team\ntags: []\n---\n\nbody\n'
  assert.equal(enforceIndexFrontmatter(own, 'tools'), own)
  // Only the reserved names — a folder the space named is the space's to describe.
  assert.equal(parseFrontmatter(enforceIndexFrontmatter('---\ntitle: Funds\ntags: []\n---\n\n', 'funds')).description, undefined)

  // Every namespace says what it holds, the directory's included: the line is
  // what makes the folder's row in the parent's listing more than a bare name.
  const people = parseFrontmatter(enforceIndexFrontmatter('---\ntitle: People\n---\n\n', 'people'))
  assert.equal(people.description, 'The people this space keeps context about.')

  // spaces/ is the directory's organisation records. The sub-space flow-up
  // sentence belongs to subspaces/, which is a different folder — they carried
  // the same line while the descriptions lived apart from the namespace table.
  const spaces = parseFrontmatter(enforceIndexFrontmatter('---\ntitle: Spaces\n---\n\n', 'spaces'))
  const subspaces = parseFrontmatter(enforceIndexFrontmatter('---\ntitle: Subspaces\n---\n\n', 'subspaces'))
  assert.match(String(spaces.description), /organisations/i)
  assert.match(String(subspaces.description), /sub-spaces/i)
  assert.notEqual(spaces.description, subspaces.description)
})

test('an entity folder index is a byte no-op on conforming content', () => {
  const ok = '---\ntype: Person\ntitle: Connor W\nnode: person:connor\n---\n\nbody\n'
  assert.equal(enforceIndexFrontmatter(ok, 'people/connor', CONNOR), ok)
  // Case of the type label is the writer's; only the meaning is enforced.
  const lower = '---\ntype: person\ntitle: Connor W\nnode: person:connor\n---\n\nbody\n'
  assert.equal(enforceIndexFrontmatter(lower, 'people/connor', CONNOR), lower)
})

test('an entity folder index fills a missing title and node from the entity', () => {
  const fixed = enforceIndexFrontmatter('no frontmatter at all\n', 'people/connor', CONNOR)
  const fm = parseFrontmatter(fixed)
  assert.equal(fm.type, 'Person')
  assert.equal(fm.title, 'Connor')
  assert.equal(fm.node, 'person:connor')
})

// The one shape, held on every index write and refresh.
test('normalizeIndexNote strips type: note, a duplicate title heading, and lists the folder', () => {
  const written =
    '---\ntimestamp: 2026-09-03T16:48:12.049Z\ntype: note\ntitle: Deals\ntags: [deals]\n---\n\n# Deals\n\nHow deals move.\n'
  const fixed = normalizeIndexNote(written, 'deals', [{ path: 'deals/pipeline.md', title: 'Pipeline' }])
  const fm = parseFrontmatter(fixed)
  assert.equal(fm.type, undefined)
  assert.deepEqual(Object.keys(fm), ['title', 'tags', 'timestamp'], 'leading keys first, the rest after')
  const body = splitFrontmatter(fixed).body
  assert.ok(body.startsWith('How deals move.'), `body: ${body}`)
  assert.ok(body.endsWith(`${CHILDREN_OPEN}\n## Notes\n\n* [Pipeline](pipeline.md)\n${CHILDREN_CLOSE}\n`), `body: ${body}`)
  assert.equal(normalizeIndexNote(fixed, 'deals', [{ path: 'deals/pipeline.md', title: 'Pipeline' }]), fixed)
})

test('normalizeIndexNote keeps an entity index whole and a writer\'s own heading', () => {
  const brief =
    '---\ntype: agent\ntitle: Inbox triage\nnode: agent:inbox-triage\ndescription: Sorts mail\ntags: [Operations]\nschedule: hourly\n---\n\n## What to do\n\nRead the inbox.\n\n' +
    `${CHILDREN_OPEN}\n${CHILDREN_CLOSE}\n`
  const agent = { typeLabel: 'agent', nodeId: 'agent:inbox-triage', name: 'Inbox triage' }
  assert.equal(normalizeIndexNote(brief, 'agents/inbox-triage', [], agent), brief)
})

test('stripDuplicateTitleHeading only takes a heading that repeats the title', () => {
  assert.equal(stripDuplicateTitleHeading('# People\n\nWho we back.\n', 'people'), 'Who we back.\n')
  assert.equal(stripDuplicateTitleHeading('# Start here\n\nProse.\n', 'People'), '# Start here\n\nProse.\n')
  assert.equal(stripDuplicateTitleHeading('Prose.\n', ''), 'Prose.\n')
})

// The rebuild folds a hand-written listing into the block.
test('foldCuratedChildren removes bare child bullets and hands back their descriptions', () => {
  const home =
    '---\ntitle: Home\ntags: [home]\n---\n\nThe firm\'s working context.\n\n## Start here\n\n' +
    '- [Portfolio](/spaces/index.md) — all 182 companies\n' +
    '- [Sectors](/sectors/index.md) (23) — where we invest\n' +
    '- [Thesis](/thesis.md)\n' +
    '- [Elsewhere](/other/thing.md) — not a child, stays\n' +
    '- [Both](/thesis.md) and [more](/team/index.md) — says more than a listing\n\n' +
    '> Every note is plain Markdown.\n\n' +
    `${CHILDREN_OPEN}\n${CHILDREN_CLOSE}\n`
  const children = [
    { path: 'spaces/index.md', title: 'Portfolio', folder: true },
    { path: 'sectors/index.md', title: 'Sectors', folder: true },
    { path: 'thesis.md', title: 'Thesis' },
    { path: 'team/index.md', title: 'Team', folder: true },
  ]
  const { content, descriptions } = foldCuratedChildren(home, children)
  assert.deepEqual(
    [...descriptions],
    [
      ['spaces/index.md', 'all 182 companies'],
      ['sectors/index.md', 'where we invest'],
    ],
  )
  const body = splitFrontmatter(content).body
  assert.ok(body.includes('- [Elsewhere](/other/thing.md) — not a child, stays'))
  assert.ok(body.includes('- [Both](/thesis.md) and [more](/team/index.md)'))
  assert.ok(!body.includes('[Portfolio]'))
  assert.ok(body.includes('## Start here'), 'a heading with something left under it stays')
  assert.ok(body.includes('> Every note is plain Markdown.'))
  assert.ok(body.endsWith(`${CHILDREN_OPEN}\n${CHILDREN_CLOSE}\n`))
})

test('foldCuratedChildren drops a heading whose whole section folded away, and is a no-op otherwise', () => {
  const listing = '---\ntitle: Team\n---\n\nWho\'s who.\n\n## People\n\n- [Niki](/team/niki.md) — Partner\n\n## Notes\n'
  const { content } = foldCuratedChildren(listing, [{ path: 'team/niki.md', title: 'Niki' }])
  assert.equal(splitFrontmatter(content).body, 'Who\'s who.\n\n## Notes\n')
  const plain = '---\ntitle: Team\n---\n\nJust prose.\n'
  assert.equal(foldCuratedChildren(plain, [{ path: 'team/niki.md', title: 'Niki' }]).content, plain)
})

test('displayTypeOf: a folder is an Index, a typed folder is its subject, a note is nothing', () => {
  assert.equal(displayTypeOf('people/index.md', null), INDEX_DISPLAY_TYPE)
  assert.equal(displayTypeOf('index.md', ''), INDEX_DISPLAY_TYPE)
  assert.equal(displayTypeOf('people/ann/index.md', 'Person'), 'Person')
  assert.equal(displayTypeOf('thesis.md', null), null)
  assert.equal(displayTypeOf('thesis.md', 'Resource'), 'Resource')
})

test('the Index label is shown, never stored: the contract still strips the spelling', () => {
  const written = enforceIndexFrontmatter(`---\ntype: ${INDEX_DISPLAY_TYPE}\ntitle: Growth\n---\n`, 'growth')
  assert.equal(declaresIndexType(written), false)
  assert.equal(displayTypeOf('growth/index.md', null), INDEX_DISPLAY_TYPE)
})
