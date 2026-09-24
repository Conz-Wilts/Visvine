// Unit tests for the Context Source pure layer: kind detection / path
// normalization (sourceTypes) and the chunkers (prose packing + overlap, CSV
// header-context repetition, caps + truncation flag).
// Run: node --import tsx --test tests/notes-source-chunking.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  chunkSourceText,
  CHUNK_CHARS,
  CHUNK_OVERLAP,
  CSV_ROWS_PER_CHUNK,
  MAX_CHUNKS,
  MAX_TEXT_CHARS,
} from '../lib/notes/shared/chunking'
import { normalizeSourcePath, sourceKindOf } from '../lib/notes/shared/sourceTypes'

// kind detection / path normalization

test('sourceKindOf maps supported extensions and rejects the rest', () => {
  assert.equal(sourceKindOf('deals.CSV'), 'csv')
  assert.equal(sourceKindOf('readme.md'), 'markdown')
  assert.equal(sourceKindOf('notes.markdown'), 'markdown')
  assert.equal(sourceKindOf('log.txt'), 'text')
  assert.equal(sourceKindOf('report.pdf'), 'pdf')
  assert.equal(sourceKindOf('image.png'), null)
})

test('normalizeSourcePath keeps source paths out of the .md note namespace', () => {
  assert.equal(normalizeSourcePath('docs/readme.md'), 'docs/readme.markdown')
  assert.equal(normalizeSourcePath('deals/pricing.csv'), 'deals/pricing.csv')
})

// prose chunking

test('short prose yields a single chunk, empty text none', () => {
  assert.equal(chunkSourceText('one small paragraph', 'text').chunks.length, 1)
  assert.deepEqual(chunkSourceText('', 'text').chunks, [])
})

test('prose splits on paragraphs near the target size with overlap carried forward', () => {
  const para = 'lorem ipsum dolor sit amet '.repeat(20).trim() // ~540 chars
  const text = Array.from({ length: 10 }, (_, i) => `Paragraph ${i}. ${para}`).join('\n\n')
  const { chunks, truncated } = chunkSourceText(text, 'text')
  assert.ok(chunks.length > 1)
  assert.ok(chunks.every((c) => c.length <= CHUNK_CHARS + CHUNK_OVERLAP + 2))
  // Each later chunk starts with the tail of its predecessor.
  for (let i = 1; i < chunks.length; i++) {
    assert.ok(chunks[i].startsWith(chunks[i - 1].slice(-CHUNK_OVERLAP)))
  }
  assert.equal(truncated, false)
})

test('a paragraph larger than the chunk size is hard-split, not dropped', () => {
  const giant = 'x'.repeat(CHUNK_CHARS * 3)
  const { chunks } = chunkSourceText(giant, 'text')
  assert.ok(chunks.length >= 3)
  assert.equal(chunks.join('').replace(/\n/g, '').length >= CHUNK_CHARS * 3, true)
})

// csv chunking

test('csv chunks repeat the header context and pack rows per chunk', () => {
  const rows = Array.from({ length: CSV_ROWS_PER_CHUNK * 2 + 5 }, (_, i) => `Acme ${i},${i * 10},NZ`)
  const csv = ['company,revenue,country', ...rows].join('\n')
  const { chunks } = chunkSourceText(csv, 'csv')
  assert.equal(chunks.length, 3)
  for (const c of chunks) assert.ok(c.startsWith('Columns: company, revenue, country'))
  assert.ok(chunks[0].includes('company: Acme 0; revenue: 0; country: NZ'))
  assert.ok(chunks[2].includes(`company: Acme ${CSV_ROWS_PER_CHUNK * 2}`))
})

test('headerless/degenerate csv falls back to prose chunking', () => {
  const { chunks } = chunkSourceText('just one line no header rows', 'csv')
  assert.equal(chunks.length, 1)
})

// caps

test('text beyond MAX_TEXT_CHARS is dropped and flagged truncated', () => {
  const { truncated, textChars } = chunkSourceText('y'.repeat(MAX_TEXT_CHARS + 100), 'text')
  assert.equal(truncated, true)
  assert.equal(textChars, MAX_TEXT_CHARS)
})

test('chunk count is capped at MAX_CHUNKS and flagged truncated', () => {
  const rows = Array.from({ length: (MAX_CHUNKS + 10) * CSV_ROWS_PER_CHUNK }, (_, i) => `r${i},v${i}`)
  const csv = ['a,b', ...rows].join('\n')
  const { chunks, truncated } = chunkSourceText(csv, 'csv')
  assert.equal(chunks.length, MAX_CHUNKS)
  assert.equal(truncated, true)
})
