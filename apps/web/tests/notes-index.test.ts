// Unit tests for the per-folder index-note helpers (lib/notes/shared/indexNote):
// path derivation and the auto-created stub content.
// Run: node --import tsx --test tests/notes-index.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  INDEX_BASENAME,
  ancestorFolders,
  buildIndexStub,
  humanizeFolderName,
  indexPathOf,
  isIndexPath,
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
    '- [Craig Piggott](/people/craig-piggott.md)',
    '- [Zoe](/people/zoe.md)',
  ])
})

test('buildIndexStub for an empty folder has frontmatter only', () => {
  const stub = buildIndexStub('deals/2026', [])
  assert.equal(parseFrontmatter(stub).title, '2026')
  assert.equal(splitFrontmatter(stub).body.trim(), '')
  assert.ok(stub.endsWith('---\n'))
})

test('INDEX_BASENAME is the canonical filename', () => {
  assert.equal(INDEX_BASENAME, 'index.md')
})
