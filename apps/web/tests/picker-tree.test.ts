// The `[[` link picker's tree (lib/notes/shared/pickerTree.ts): folding paths
// into folders, the index-only folder drawn as a leaf, pruning and guides.
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/picker-tree.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { buildPickerTree, prunePickerTree, visiblePickerRows, titleOf } from '../lib/notes/shared/pickerTree'

const leaf = (path: string, title = path) => ({ path, title, ref: null })

const tree = buildPickerTree([
  leaf('welcome.md', 'Welcome'),
  leaf('people/index.md', 'People'),
  leaf('people/aiko/index.md', 'Aiko Tanaka'),
  leaf('people/amiria/index.md', 'Amiria Nikora'),
  leaf('people/amiria/call.md', 'Call notes'),
  leaf('deals/acme.md', 'Acme'),
])

test('folders sort before notes, and an index names its folder', () => {
  assert.deepEqual(tree.map(titleOf), ['Deals', 'People', 'Welcome'])
  const people = tree[1]
  assert.equal(people.kind, 'folder')
  assert.equal(people.kind === 'folder' && people.index?.path, 'people/index.md')
})

test('a folder holding only its index is one leaf', () => {
  const people = tree[1]
  assert.ok(people.kind === 'folder')
  const kinds = people.children.map((n) => [n.kind, titleOf(n)])
  assert.deepEqual(kinds, [['folder', 'Amiria Nikora'], ['leaf', 'Aiko Tanaka']])
})

test('pruning opens the folders a match sits in, not a folder matched by name', () => {
  const hit = prunePickerTree(tree, (t) => t.toLowerCase().includes('call'))
  assert.deepEqual([...hit.open].sort(), ['people', 'people/amiria'])
  const byName = prunePickerTree(tree, (t) => t === 'People')
  assert.equal(byName.open.size, 0)
  assert.equal(byName.nodes.length, 1)
})

test('rows carry one guide per level below the top', () => {
  const rows = visiblePickerRows(tree, (p) => p === 'people' || p === 'people/amiria')
  const shape = rows.map((r) => [titleOf(r.node), r.guides.join(',')])
  assert.deepEqual(shape, [
    ['Deals', ''],
    ['People', ''],
    ['Amiria Nikora', 'mid'],
    ['Call notes', 'mid,last'],
    ['Aiko Tanaka', 'last'],
    ['Welcome', ''],
  ])
})
