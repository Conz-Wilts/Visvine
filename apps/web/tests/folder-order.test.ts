import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTree } from '../lib/notes/shared/context'
import { orderKeyOf, orderOf, withOrder } from '../lib/notes/shared/folderOrder'
import type { NoteMeta } from '../lib/notes/shared/types'

function meta(path: string, frontmatter: Record<string, unknown> = {}): NoteMeta {
  const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  return { path, folder, title: path, frontmatter, linkTargets: [] } as unknown as NoteMeta
}

const names = (metas: NoteMeta[], folder: string) => {
  const root = buildTree(metas)
  const node = folder ? root.children!.find((c) => c.path === folder)! : root
  return node.children!.map((c) => c.name).filter((n) => n !== 'index.md')
}

test('a folder sorts by name until it is arranged', () => {
  const metas = [meta('ops/index.md'), meta('ops/b.md'), meta('ops/a.md'), meta('ops/sub/x.md')]
  assert.deepEqual(names(metas, 'ops'), ['sub', 'a.md', 'b.md'])
})

test('order: puts the rows it names first, as listed; the rest follow by name', () => {
  const metas = [
    meta('ops/index.md', { order: ['b.md', 'sub', 'gone.md'] }),
    meta('ops/b.md'),
    meta('ops/a.md'),
    meta('ops/c.md'),
    meta('ops/sub/x.md'),
  ]
  assert.deepEqual(names(metas, 'ops'), ['b.md', 'sub', 'a.md', 'c.md'])
})

test('the root is ordered by its own index note', () => {
  const metas = [meta('index.md', { order: ['z.md', 'a.md'] }), meta('a.md'), meta('z.md')]
  assert.deepEqual(names(metas, ''), ['z.md', 'a.md'])
})

test('orderKeyOf: a row is named inside its folder, a drawn-only row by its path', () => {
  assert.equal(orderKeyOf('ops', 'ops/a.md'), 'a.md')
  assert.equal(orderKeyOf('', 'a.md'), 'a.md')
  assert.equal(orderKeyOf('ops', 'agents'), 'agents')
})

test('withOrder round-trips and leaves the body alone', () => {
  const next = withOrder('---\ntitle: Ops\n---\n\nBody.\n', ['b.md', 'b.md', ' a.md '])
  assert.match(next, /Body\./)
  assert.match(next, /title: Ops/)
  const again = withOrder(next, [])
  assert.doesNotMatch(again, /order:/)
  assert.deepEqual(orderOf({ order: ['b.md', 'b.md', ' a.md ', 3] } as never), ['b.md', 'a.md'])
})
