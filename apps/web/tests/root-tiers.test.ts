// How the top of the context tree is DRAWN (lib/notes/shared/rootTiers.ts):
// the space, then Main, then the rooms. Pure — no note moves.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MAIN_PATH, MAIN_TITLE, tierRoot } from '../lib/notes/shared/rootTiers'
import { graftParent, graftSubspace } from '../lib/spaces/subspaces'
import { sortTree } from '../lib/notes/shared/context'
import type { TreeNode } from '../lib/notes/shared/types'

const empty = (): TreeNode => ({ name: '', path: '', kind: 'folder', children: [] })
const folder = (path: string): TreeNode => ({ name: path, path, kind: 'folder', title: path, children: [] })
const note = (path: string): TreeNode => ({ name: path, path, kind: 'note' })

function house(): TreeNode {
  const root = empty()
  root.children!.push(note('index.md'), folder('people'), folder('events'))
  return root
}

describe('tierRoot — the space, then Main, then the rooms', () => {
  it('a space with no rooms is drawn exactly as it was: no Main row for one tier', () => {
    const root = house()
    assert.equal(tierRoot(root), root)
  })

  it('the space’s own context becomes Main, and each room a row beside it', () => {
    const root = house()
    graftSubspace(root, { id: 'hr', name: 'HR' }, empty())
    graftSubspace(root, { id: 'finance', name: 'Finance' }, empty())
    sortTree(root)
    const drawn = tierRoot(root)
    assert.deepEqual(drawn.children!.map((c) => c.title), [MAIN_TITLE, 'Finance', 'HR'])
    // Main holds what the space holds — and nothing of the rooms'.
    assert.deepEqual(
      drawn.children![0].children!.map((c) => c.path),
      ['events', 'people', 'index.md'],
    )
  })

  it('Main stands for the context root: its path is reserved, never a note’s', () => {
    const root = house()
    graftSubspace(root, { id: 'hr', name: 'HR' }, empty())
    const main = tierRoot(root).children![0]
    assert.equal(main.path, MAIN_PATH)
    assert.equal(main.drawn, 'main')
    assert.ok(MAIN_PATH.startsWith(':'))
  })

  it('a room keeps its address — the tier is drawing, not a move', () => {
    const root = house()
    graftSubspace(root, { id: 'hr', name: 'HR' }, empty())
    const room = tierRoot(root).children![1]
    assert.equal(room.path, 'subspaces/hr')
    assert.equal(room.space, 'hr')
    // Stamped federated so it sorts below Main and draws the tier seam.
    assert.equal(room.federated, true)
  })

  it('`parent/` is drawn in the rooms’ tier, not inside Main', () => {
    const root = house()
    graftSubspace(root, { id: 'hr', name: 'HR' }, empty())
    graftParent(root, { id: 'house', name: 'Blackbird' }, empty())
    const drawn = tierRoot(root)
    assert.deepEqual(drawn.children!.map((c) => c.path), [MAIN_PATH, 'subspaces/hr', 'parent'])
  })

  it('an empty `Sub-spaces` folder is not a tier — nothing to lift, nothing to wrap', () => {
    const root = house()
    root.children!.push({ name: 'subspaces', path: 'subspaces', kind: 'folder', federated: true, children: [] })
    assert.equal(tierRoot(root), root)
  })
})
