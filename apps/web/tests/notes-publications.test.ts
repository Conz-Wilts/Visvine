// Unit tests for the pure part of cross-brain publishing: the replica content
// builder (lib/notes/publications.ts#replicaContent) — provenance must be
// stamped, the body preserved, and an existing author never overwritten.
// Run: node --import tsx --test tests/notes-publications.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { replicaContent } from '../lib/notes/publications'
import { parseFrontmatter, splitFrontmatter } from '../lib/notes/shared/markdown'

test('replicaContent stamps published-from and fills in the publisher as author', () => {
  const src = '---\ntype: note\ntitle: Canva\n---\n\n# Canva\n\nDeal notes.\n'
  const out = replicaContent(src, { ref: 'me:u1/portfolio/canva.md', publisher: 'Connor' })
  const fm = parseFrontmatter(out)
  assert.equal(fm['published-from'], 'me:u1/portfolio/canva.md')
  assert.equal(fm.author, 'Connor')
  assert.equal(fm.title, 'Canva')
  assert.match(splitFrontmatter(out).body, /# Canva\n\nDeal notes\./)
})

test('replicaContent keeps an existing author and works on frontmatter-less notes', () => {
  const withAuthor = '---\nauthor: Jane\n---\n\nBody.\n'
  const fm = parseFrontmatter(replicaContent(withAuthor, { ref: 'ref-1', publisher: 'Connor' }))
  assert.equal(fm.author, 'Jane')
  assert.equal(fm['published-from'], 'ref-1')

  const bare = '# Just a body\n'
  const out = replicaContent(bare, { ref: 'ref-2', publisher: 'Connor' })
  assert.equal(parseFrontmatter(out)['published-from'], 'ref-2')
  assert.match(splitFrontmatter(out).body, /# Just a body/)
})
