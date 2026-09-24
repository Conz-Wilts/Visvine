/**
 * restoreFrontmatterFence (lib/notes/shared/markdown.ts): a note whose
 * frontmatter lost its opening `---` gets it back, and nothing else changes.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/markdown-fence.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseFrontmatter, restoreFrontmatterFence } from '@/lib/notes/shared/markdown'

test('a missing opening fence is put back', () => {
  const fixed = restoreFrontmatterFence('title: Top AI stories\ntags:\n  - ai\n---\n1. One\n')
  assert.equal(fixed, '---\ntitle: Top AI stories\ntags:\n  - ai\n---\n1. One\n')
  assert.equal(parseFrontmatter(fixed).title, 'Top AI stories')
})

test('everything else is left as written', () => {
  for (const md of [
    '---\ntitle: Fine\n---\nBody\n',
    'Just prose.\n\n---\n\nMore prose after a rule.\n',
    'Note: this is a sentence, not a key.\nSecond line.\n---\nrest\n',
    'title: No closing fence\nBody\n',
    'title: [unclosed\n---\nBody\n',
  ]) {
    assert.equal(restoreFrontmatterFence(md), md, md)
  }
})
