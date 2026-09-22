// How deep the context tree draws before it drills in
// (lib/notes/shared/treeFocus.ts). Pure — depth is counted in the drawn tree.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { drawnChain, focusFor, focusUp, maxRowDepthFor } from '../lib/notes/shared/treeFocus'
import type { TreeNode } from '../lib/notes/shared/types'

const folder = (path: string, children: TreeNode[] = []): TreeNode => ({
  name: path.split('/').pop() ?? '',
  path,
  kind: 'folder',
  children,
})
const note = (path: string): TreeNode => ({ name: path.split('/').pop() ?? '', path, kind: 'note' })

/** a/b/c/d/e/f/g, one folder per level, a note and an index at the bottom. */
function deep(): TreeNode {
  const levels = ['a', 'a/b', 'a/b/c', 'a/b/c/d', 'a/b/c/d/e', 'a/b/c/d/e/f', 'a/b/c/d/e/f/g']
  let node: TreeNode = folder(levels[levels.length - 1], [
    note('a/b/c/d/e/f/g/index.md'),
    note('a/b/c/d/e/f/g/leaf.md'),
  ])
  for (let i = levels.length - 2; i >= 0; i--) node = folder(levels[i], [node])
  return folder('', [note('index.md'), node])
}

const paths = (chain: TreeNode[] | null) => chain?.map((n) => n.path)

describe('drawnChain', () => {
  it('lists the folders above a row, root first', () => {
    assert.deepEqual(paths(drawnChain(deep(), 'a/b/c')), ['', 'a', 'a/b'])
    assert.deepEqual(paths(drawnChain(deep(), 'a/b/c/d/e/f/g/leaf.md')), [
      '', 'a', 'a/b', 'a/b/c', 'a/b/c/d', 'a/b/c/d/e', 'a/b/c/d/e/f', 'a/b/c/d/e/f/g',
    ])
  })

  it('draws an index note as its folder', () => {
    assert.deepEqual(paths(drawnChain(deep(), 'a/b/c/d/e/f/g/index.md')), paths(drawnChain(deep(), 'a/b/c/d/e/f/g')))
    assert.deepEqual(drawnChain(deep(), 'index.md'), [])
  })

  it('follows the drawn tree, not the path', () => {
    // A placed folder: `agents` drawn under `team`.
    const root = folder('', [folder('team', [folder('agents', [note('agents/x/index.md')])])])
    assert.deepEqual(paths(drawnChain(root, 'agents')), ['', 'team'])
    assert.equal(drawnChain(root, 'nowhere.md'), null)
  })
})

describe('focusFor', () => {
  const tree = deep()
  const chainTo = (path: string) => drawnChain(tree, path)!

  it('draws the whole tree while every row fits', () => {
    assert.equal(focusFor(chainTo('a/b/c'), null, 6), null)
  })

  it('drills in past the edge, keeping two levels above the parent', () => {
    // leaf.md is drawn 8 deep; its parent g is 7, so the tree draws from e.
    assert.equal(focusFor(chainTo('a/b/c/d/e/f/g/leaf.md'), null, 6), 'a/b/c/d/e')
  })

  it('keeps a focus the row already fits inside', () => {
    // After `..`, a click inside the focused branch must not drill back in.
    assert.equal(focusFor(chainTo('a/b/c/d/e/f/g/leaf.md'), 'a/b', 6), 'a/b')
  })

  it('moves a focus the row is outside of', () => {
    assert.equal(focusFor(chainTo('a/b'), 'a/b/c/d', 6), null)
    const other = folder('', [...(tree.children ?? []), folder('z', [note('z/n.md')])])
    assert.equal(focusFor(drawnChain(other, 'z/n.md')!, 'a/b/c/d', 6), null)
  })

  it('never focuses the root itself', () => {
    assert.equal(focusFor(chainTo('a/b/c/d/e/f/g/leaf.md'), null, 1), 'a/b/c/d/e')
    assert.equal(focusFor(chainTo('a/b/c'), null, 1), null)
  })
})

describe('focusUp', () => {
  it('steps up one level, and out to the whole tree from the top', () => {
    const tree = deep()
    assert.equal(focusUp(drawnChain(tree, 'a/b/c/d/e')!), 'a/b/c/d')
    assert.equal(focusUp(drawnChain(tree, 'a')!), null)
  })
})

describe('maxRowDepthFor', () => {
  it('fits more levels in a wider panel, never fewer than three', () => {
    assert.ok(maxRowDepthFor(600) > maxRowDepthFor(300))
    assert.equal(maxRowDepthFor(0), 3)
  })
})
