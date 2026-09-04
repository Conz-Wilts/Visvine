// Unit tests for the note chunker (lib/notes/shared/noteChunks.ts) and its
// place in the fusion (chunks fold onto their note; the best one is the
// result's `passage`).
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/note-chunks.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  chunkNote,
  MAX_NOTE_CHUNKS,
  NOTE_CHUNK_CHARS,
  NOTE_CHUNK_MAX_CHARS,
  NOTE_CHUNK_OVERLAP,
} from '../lib/notes/shared/noteChunks'
import { CHILDREN_OPEN, CHILDREN_CLOSE } from '../lib/notes/shared/indexNote'
import { fusedSearch, type ChunkStage, type RetrievalNote } from '../lib/notes/shared/retrieval'
import { buildNoteIndex } from '../lib/notes/shared/context'
import { splitFrontmatter } from '../lib/notes/shared/markdown'
import type { RawNote } from '../lib/notes/shared/types'

const sentence = (n: number, word = 'Halter') => `${word} sentence number ${n} says something worth finding. `
const para = (n: number, word?: string) => Array.from({ length: 6 }, (_, i) => sentence(n * 10 + i, word)).join('').trim()

test('a short note is one chunk carrying its title as breadcrumb', () => {
  const { chunks, truncated } = chunkNote('Craig Piggott', 'CEO of Halter. Based in Auckland.')
  assert.equal(truncated, false)
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].seq, 0)
  assert.equal(chunks[0].heading, '')
  assert.equal(chunks[0].text, 'CEO of Halter. Based in Auckland.')
  assert.equal(chunks[0].embedText, 'Craig Piggott\nCEO of Halter. Based in Auckland.')
})

test('an empty body still yields a chunk so a stub is findable by name', () => {
  const { chunks } = chunkNote('Empty stub', '')
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].embedText, 'Empty stub')
})

test('headings split sections; the breadcrumb carries the heading path', () => {
  const body = [
    para(0, 'Preamble'),
    '## Halter',
    para(1, 'Halter'),
    '### Q3 targets',
    para(2, 'Targets'),
    '## Fonterra',
    para(3, 'Fonterra'),
  ].join('\n\n')
  const { chunks } = chunkNote('Portfolio', body)
  const headings = chunks.map((c) => c.heading)
  assert.deepEqual(headings, ['', 'Halter', 'Halter > Q3 targets', 'Fonterra'])
  assert.ok(chunks[2].embedText.startsWith('Portfolio > Halter > Q3 targets\n'))
  // Stored text is the prose alone — the breadcrumb is only for the vector.
  assert.ok(!chunks[2].text.includes('Portfolio'))
  assert.deepEqual(chunks.map((c) => c.seq), [0, 1, 2, 3])
})

test('a heading inside a code fence does not open a section', () => {
  const body = ['Intro prose here.', '```', '# not a heading', 'code', '```', 'More prose.'].join('\n')
  const { chunks } = chunkNote('Snippet', body)
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].heading, '')
})

test('a long section packs paragraphs to the target with overlap', () => {
  const paras = Array.from({ length: 8 }, (_, i) => para(i))
  const { chunks } = chunkNote('Long', paras.join('\n\n'))
  assert.ok(chunks.length > 1)
  for (const c of chunks) assert.ok(c.text.length <= NOTE_CHUNK_CHARS + NOTE_CHUNK_OVERLAP + 2, `chunk ${c.seq} too long`)
  // The second chunk begins with the tail of the first, cut at a word boundary.
  const tail = chunks[0].text.slice(-NOTE_CHUNK_OVERLAP)
  const firstWord = chunks[1].text.split(/\s/)[0]
  assert.ok(tail.includes(firstWord))
  assert.ok(!chunks[1].text.startsWith(' '))
})

test('one giant paragraph is cut at sentence ends, never past the hard cap', () => {
  const giant = Array.from({ length: 80 }, (_, i) => sentence(i)).join('')
  const { chunks } = chunkNote('Wall', giant)
  assert.ok(chunks.length > 1)
  for (const c of chunks) {
    assert.ok(c.text.length <= NOTE_CHUNK_MAX_CHARS)
    assert.match(c.text, /\.$/)
  }
})

test('a tiny trailing section folds into the one before it', () => {
  const body = [para(0), '## Links', '- [a](/a.md)'].join('\n\n')
  const { chunks } = chunkNote('Folded', body)
  assert.equal(chunks.length, 1)
  assert.ok(chunks[0].text.includes('[a](/a.md)'))
})

test("an index note's machine child list and HTML comments are not chunk text", () => {
  const body = ['About this folder.', CHILDREN_OPEN, '- [Craig](/people/craig/index.md)', CHILDREN_CLOSE, '<!-- note -->'].join('\n')
  const { chunks } = chunkNote('People', body)
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].text, 'About this folder.')
})

test('chunks are capped and the cap is reported', () => {
  const body = Array.from({ length: MAX_NOTE_CHUNKS + 10 }, (_, i) => `## S${i}\n\n${para(i)}`).join('\n\n')
  const { chunks, truncated } = chunkNote('Huge', body)
  assert.equal(chunks.length, MAX_NOTE_CHUNKS)
  assert.equal(truncated, true)
})

test('chunking is deterministic', () => {
  const body = [para(0), '## A', para(1), '## B', para(2)].join('\n\n')
  assert.deepEqual(chunkNote('Same', body), chunkNote('Same', body))
})

// --- fusion ---------------------------------------------------------------

const note = (path: string, content: string, mtime = 0): RawNote => ({ path, content, mtime })
const toRetrieval = (raws: RawNote[]): RetrievalNote[] => {
  const metas = buildNoteIndex(raws)
  const bodyByPath = new Map(raws.map((r) => [r.path, splitFrontmatter(r.content).body]))
  return metas.map((meta) => ({ meta, body: bodyByPath.get(meta.path)! }))
}

test('chunk hits fold onto their note and the best one is the passage', async () => {
  const notes = toRetrieval([
    note('brief.md', '---\ntitle: Brief\n---\nA long brief about many things.\n\n## Pricing\n\nThe pricing model is per cow per month.'),
    note('other.md', '---\ntitle: Other\n---\nUnrelated prose about the weather.'),
  ])
  const chunks: ChunkStage = {
    async rank() {
      return [
        { path: 'brief.md', seq: 1, heading: 'Pricing', text: 'The pricing model is per cow per month.', score: 0.91 },
        { path: 'brief.md', seq: 0, heading: '', text: 'A long brief about many things.', score: 0.7 },
        { path: 'gone.md', seq: 0, heading: '', text: 'stale', score: 0.99 },
      ]
    },
  }
  const hits = await fusedSearch(notes, 'pricing per cow', {}, { chunks, contextExpand: false })
  const brief = hits.find((h) => h.path === 'brief.md')
  assert.ok(brief)
  assert.equal(hits.filter((h) => h.path === 'brief.md').length, 1)
  assert.deepEqual(brief.passage, { heading: 'Pricing', text: 'The pricing model is per cow per month.' })
  assert.ok(!hits.some((h) => h.path === 'gone.md'))
})

test('a note only the chunk stage found previews its passage', async () => {
  const notes = toRetrieval([
    note('deep.md', '---\ntitle: Deep\n---\nOpening remarks.\n\n## Detail\n\nGrazing rotations move every twelve hours.'),
  ])
  const chunks: ChunkStage = {
    async rank() {
      return [{ path: 'deep.md', seq: 1, heading: 'Detail', text: 'Grazing rotations move every twelve hours.', score: 0.8 }]
    },
  }
  const hits = await fusedSearch(notes, 'zzzz', {}, { chunks, contextExpand: false })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].snippet, 'Grazing rotations move every twelve hours.')
})
