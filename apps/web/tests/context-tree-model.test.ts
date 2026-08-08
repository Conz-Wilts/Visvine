// Unit tests for the Context explorer's row model — the pure flattening,
// pruning and link-neighborhood logic the virtualized tree renders from.
// Run with: node --import tsx --test tests/context-tree-model.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  flattenVisibleRows,
  ancestorClosure,
  neighborhoodOf,
  type TreeRow,
} from '../components/context/contextTreeModel'
import { ROOT_PATH, TRASH_PATH, ancestorChain } from '../hooks/useContextTreeState'
import type { TreeNode } from '../lib/notes/shared/types'
import type { ContextItem } from '../hooks/useContextBrowse'

const item = (path: string, over: Partial<ContextItem> = {}): ContextItem => ({
  path,
  title: path.split('/').pop()!.replace('.md', ''),
  folder: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
  type: null,
  tags: [],
  mtime: 0,
  linkTargets: [],
  unresolved: [],
  backlinkCount: 0,
  ...over,
})

// people/{craig.md, index.md, acme/{index.md, deal.md}}, welcome.md, index.md
const tree: TreeNode = {
  name: '',
  path: '',
  kind: 'folder',
  children: [
    {
      name: 'people',
      path: 'people',
      kind: 'folder',
      // Titled from people/index.md by buildTree — the folder's display name.
      title: 'People Directory',
      children: [
        { name: 'craig.md', path: 'people/craig.md', kind: 'note', title: 'Craig' },
        { name: 'index.md', path: 'people/index.md', kind: 'note', title: 'People' },
        {
          name: 'acme',
          path: 'people/acme',
          kind: 'folder',
          children: [
            { name: 'index.md', path: 'people/acme/index.md', kind: 'note', title: 'Acme' },
            { name: 'deal.md', path: 'people/acme/deal.md', kind: 'note', title: 'Deal' },
          ],
        },
      ],
    },
    { name: 'welcome.md', path: 'welcome.md', kind: 'note', title: 'Welcome' },
    { name: 'index.md', path: 'index.md', kind: 'note', title: 'Root Index' },
  ],
}

const items = new Map(
  ['people/craig.md', 'people/acme/deal.md', 'welcome.md', 'index.md'].map((p) => [p, item(p)]),
)

const flatten = (openPaths: Set<string>, over: Record<string, unknown> = {}) =>
  flattenVisibleRows({
    tree,
    itemsByPath: items,
    openPaths,
    keep: null,
    rootLabel: 'Brain',
    ...over,
  })

const keys = (rows: TreeRow[]) => rows.map((r) => r.key)

// --- ancestorChain / ancestorClosure ----------------------------------------

test('ancestorChain includes the root row and every folder down to the note', () => {
  assert.deepEqual(ancestorChain('people/acme/index.md'), [ROOT_PATH, 'people', 'people/acme'])
  assert.deepEqual(ancestorChain('welcome.md'), [ROOT_PATH])
})

test('ancestorClosure unions chains across paths', () => {
  const closure = ancestorClosure(['people/acme/deal.md', 'welcome.md'])
  assert.deepEqual([...closure].sort(), ['', 'people', 'people/acme'])
})

// --- flattening --------------------------------------------------------------

test('collapsed root renders only the root and trash rows', () => {
  const rows = flatten(new Set())
  assert.deepEqual(keys(rows), [':root:'])
  assert.equal(rows[0].isOpen, false)
  assert.equal(rows[0].childCount, 4) // craig, deal, welcome, root index
})

test('open folders flatten depth-first with correct depths', () => {
  const rows = flatten(new Set([ROOT_PATH, 'people']))
  assert.deepEqual(keys(rows), [
    ':root:',
    'people',
    'people/craig.md',
    'people/acme',
    'welcome.md',
    'index.md',
  ])
  const depths = Object.fromEntries(rows.map((r) => [r.key, r.depth]))
  assert.equal(depths['people'], 1)
  assert.equal(depths['people/craig.md'], 2)
  assert.equal(depths['welcome.md'], 1)
})

test('a folder row shows its index title, falling back to the path segment', () => {
  const rows = flatten(new Set([ROOT_PATH, 'people']))
  assert.equal(rows.find((r) => r.key === 'people')!.label, 'People Directory')
  // people/acme carries no title on its node, so it stays its segment.
  const nested = flatten(new Set([ROOT_PATH, 'people', 'people/acme']))
  assert.equal(nested.find((r) => r.key === 'people/acme')!.label, 'acme')
  assert.equal(rows.find((r) => r.path === ROOT_PATH)!.label, 'Brain')
})

test("a folder's index note folds into the folder row; the root's does not", () => {
  const rows = flatten(new Set([ROOT_PATH, 'people', 'people/acme']))
  const paths = rows.map((r) => r.path)
  assert.ok(!paths.includes('people/index.md'))
  assert.ok(!paths.includes('people/acme/index.md'))
  assert.ok(paths.includes('index.md'))
  const acme = rows.find((r) => r.key === 'people/acme')!
  assert.equal(acme.indexPath, 'people/acme/index.md')
  assert.equal(acme.childCount, 1) // deal.md only
})

test('keep set prunes notes and empty folders but keeps the matched chain', () => {
  const matchSet = new Set(['people/acme/deal.md'])
  const keep = new Set([...matchSet, ...ancestorClosure(matchSet)])
  const rows = flatten(new Set([ROOT_PATH, 'people', 'people/acme']), { keep, matched: matchSet })
  assert.deepEqual(keys(rows), [':root:', 'people', 'people/acme', 'people/acme/deal.md'])
  assert.equal(rows.at(-1)!.matched, true)
  assert.equal(rows.find((r) => r.key === 'people')!.childCount, 1)
})

test('starred section renders above the tree with prefixed keys', () => {
  const rows = flatten(new Set([ROOT_PATH]), { starred: ['welcome.md', 'gone.md'] })
  assert.equal(rows[0].kind, 'section')
  assert.equal(rows[1].key, 'starred:welcome.md') // no collision with the tree copy
  assert.ok(!keys(rows).includes('starred:gone.md')) // unknown paths dropped
})

test('trash renders as a pinned folder whose entries expand', () => {
  const trash = [{ id: 't1', name: 'old.md', path: 'old.md', deletedAt: 0 }]
  const closed = flatten(new Set([ROOT_PATH]), { trash })
  assert.equal(closed.at(-1)!.kind, 'trash')
  assert.equal(closed.at(-1)!.childCount, 1)
  const open = flatten(new Set([ROOT_PATH, TRASH_PATH]), { trash })
  assert.equal(open.at(-1)!.kind, 'trash-entry')
  assert.equal(open.at(-1)!.trashEntry!.id, 't1')
})

// --- neighborhoodOf ----------------------------------------------------------

test('neighborhoodOf is self + outgoing + incoming, one hop', () => {
  const all = [
    item('a.md', { linkTargets: ['b.md'] }),
    item('b.md'),
    item('c.md', { linkTargets: ['a.md'] }),
    item('d.md', { linkTargets: ['c.md'] }), // two hops out — excluded
  ]
  assert.deepEqual([...neighborhoodOf('a.md', all)].sort(), ['a.md', 'b.md', 'c.md'])
})
