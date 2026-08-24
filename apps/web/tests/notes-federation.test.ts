// Sub-space federation: what crosses from a child space's tree into its record
// folder in the parent, and how its paths are rebased (lib/notes/shared/federation).
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/notes-federation.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { graftForeign, spaceFolders } from '@/lib/notes/shared/federation'
import { buildTree } from '@/lib/notes/shared/context'
import type { NoteMeta, TreeNode } from '@/lib/notes/shared/types'

const meta = (path: string, frontmatter: Record<string, unknown> = {}): NoteMeta =>
  ({
    path,
    folder: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
    title: path.split('/').pop()!.replace(/\.md$/, ''),
    frontmatter,
    tags: [],
    links: [],
    unresolved: [],
    mtime: 0,
  }) as unknown as NoteMeta

/** The parent context: a record folder for the child, beside a folder of its own. */
function parentTree(): TreeNode {
  return buildTree([
    meta('index.md'),
    meta('building-blackbird/index.md', { type: 'Space', space: 'building-blackbird' }),
    meta('connectors/index.md'),
  ])
}

test('a record folder declares the space it stands for', () => {
  const found = spaceFolders(parentTree())
  assert.deepEqual(
    found.map((f) => [f.path, f.space]),
    [['building-blackbird', 'building-blackbird']],
  )
  // A folder with no `space:` in its index is an ordinary folder.
  assert.deepEqual(spaceFolders(buildTree([meta('deals/index.md')])), [])
})

test('the child tree is rebased under the record folder and marked foreign', () => {
  const root = parentTree()
  const folder = spaceFolders(root)[0]
  const child = buildTree([meta('index.md'), meta('connectors/stripe.md'), meta('tools/index.md')])

  graftForeign(folder, child, 'building-blackbird')

  // Beside the parent's own record note, which stays where it was.
  const names = (folder.children ?? []).map((c) => c.path).sort()
  assert.deepEqual(names, [
    'building-blackbird/connectors',
    'building-blackbird/index.md',
    'building-blackbird/tools',
  ])

  const connectors = folder.children!.find((c) => c.path === 'building-blackbird/connectors')!
  assert.deepEqual(connectors.foreign, { spaceId: 'building-blackbird', path: 'connectors' })
  // Every descendant carries its own foreign path, so a click anywhere in the
  // subtree opens the right note in the right space.
  const stripe = connectors.children![0]
  assert.equal(stripe.path, 'building-blackbird/connectors/stripe.md')
  assert.deepEqual(stripe.foreign, { spaceId: 'building-blackbird', path: 'connectors/stripe.md' })
})

test('the child’s own index note does not come across', () => {
  const root = parentTree()
  const folder = spaceFolders(root)[0]
  graftForeign(folder, buildTree([meta('index.md')]), 'building-blackbird')
  // The parent's record note is already this folder's home page — the child's
  // index would be a second row saying the same thing. The folder keeps its own
  // index note and gains nothing.
  assert.deepEqual(
    (folder.children ?? []).map((c) => c.path),
    ['building-blackbird/index.md'],
  )
  assert.equal((folder.children ?? []).some((c) => c.foreign), false)
})

test('a note the parent wrote under the record folder wins its path', () => {
  const root = buildTree([
    meta('building-blackbird/index.md', { type: 'Space', space: 'building-blackbird' }),
    meta('building-blackbird/notes.md'),
  ])
  const folder = spaceFolders(root)[0]
  graftForeign(folder, buildTree([meta('notes.md'), meta('tools/index.md')]), 'building-blackbird')

  const local = folder.children!.find((c) => c.path === 'building-blackbird/notes.md')!
  assert.equal(local.foreign, undefined, 'the parent’s own note is not replaced by the child’s')
  assert.equal(folder.children!.filter((c) => c.path === 'building-blackbird/notes.md').length, 1)
  // Everything that does not collide still crosses.
  assert.ok(folder.children!.some((c) => c.path === 'building-blackbird/tools'))
})
