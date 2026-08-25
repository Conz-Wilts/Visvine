// Unit tests for the derived memory tier's pure half (which notes yield
// memories, coercion of an extraction) and its place in the fusion (claims fold
// onto their note, the best one is the result's `claim`).
// Run: node --import tsx --test tests/context-memories.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { coerceClaims, MAX_CLAIMS_PER_NOTE, yieldsMemories } from '../lib/notes/shared/memories'
import { fusedSearch, type MemoryStage, type RetrievalNote } from '../lib/notes/shared/retrieval'
import { buildNoteIndex } from '../lib/notes/shared/context'
import { splitFrontmatter } from '../lib/notes/shared/markdown'
import type { RawNote } from '../lib/notes/shared/types'

const note = (path: string, content: string, mtime = 0): RawNote => ({ path, content, mtime })
const toRetrieval = (raws: RawNote[]): RetrievalNote[] => {
  const metas = buildNoteIndex(raws)
  const bodyByPath = new Map(raws.map((r) => [r.path, splitFrontmatter(r.content).body]))
  return metas.map((meta) => ({ meta, body: bodyByPath.get(meta.path)! }))
}
const long = 'A sentence with enough in it to be worth reading. '.repeat(4)

test('yieldsMemories: index notes, config folders, opt-outs and stubs do not', () => {
  const meta = (path: string, fm: Record<string, unknown> = {}) => ({ path, frontmatter: fm })
  assert.equal(yieldsMemories(meta('people/craig.md'), long), true)
  assert.equal(yieldsMemories(meta('people/index.md'), long), false)
  assert.equal(yieldsMemories(meta('connectors/hubspot.md'), long), false)
  assert.equal(yieldsMemories(meta('agents/digest.md'), long), false)
  assert.equal(yieldsMemories(meta('tools/x/index.md'), long), false)
  assert.equal(yieldsMemories(meta('people/craig.md', { memories: false }), long), false)
  assert.equal(yieldsMemories(meta('people/craig.md'), 'too short'), false)
  // A top-level note named like a config folder is still a note.
  assert.equal(yieldsMemories(meta('agents.md'), long), true)
})

test('coerceClaims: strings only, markers stripped, dupes and excerpts dropped, capped', () => {
  const claims = coerceClaims({
    claims: [
      '- Craig Piggott is the CEO of Halter.',
      'craig piggott is the ceo of halter',
      '  Halter   raised   $100m  in 2024. ',
      'x'.repeat(300),
      42,
      '',
      ...Array.from({ length: 20 }, (_, i) => `Fact number ${i}.`),
    ],
  })
  assert.equal(claims[0], 'Craig Piggott is the CEO of Halter.')
  assert.equal(claims[1], 'Halter raised $100m in 2024.')
  assert.equal(claims.length, MAX_CLAIMS_PER_NOTE)
  assert.deepEqual(coerceClaims(null), [])
  assert.deepEqual(coerceClaims({ claims: 'not a list' }), [])
})

test('fusedSearch: memory hits fold onto their note and the best claim is the result', async () => {
  const notes = toRetrieval([
    note('people/craig.md', '---\ntitle: Craig\n---\nLong profile prose that never says the word.', 1),
    note('people/other.md', '---\ntitle: Other\n---\nunrelated', 1),
  ])
  const memories: MemoryStage = {
    rank: async () => [
      { path: 'people/craig.md', seq: 2, text: 'Craig lives in Auckland.', score: 0.9 },
      { path: 'people/craig.md', seq: 0, text: 'Craig is the CEO of Halter.', score: 0.6 },
      { path: 'people/gone.md', seq: 0, text: 'A claim from a note not in the candidate set.', score: 0.99 },
    ],
    keyword: async () => [{ path: 'people/craig.md', seq: 2, text: 'Craig lives in Auckland.', score: 0.2 }],
  }
  const hits = await fusedSearch(notes, 'where does craig live', {}, { memories })
  // One result for the note, not one per claim; the invisible note never appears.
  assert.deepEqual(hits.map((h) => h.path), ['people/craig.md'])
  assert.equal(hits[0].claim, 'Craig lives in Auckland.')
  assert.ok(hits[0].snippet)
})

test('fusedSearch: a claim match lifts a note above one that only shares words', async () => {
  const notes = toRetrieval([
    note('a.md', '---\ntitle: A\n---\nthe offsite venue was discussed at length', 1),
    note('b.md', '---\ntitle: B\n---\nnotes about the offsite venue and catering and the offsite venue again', 1),
  ])
  const memories: MemoryStage = {
    rank: async () => [{ path: 'a.md', seq: 0, text: 'The offsite venue is Waiheke.', score: 0.95 }],
  }
  const without = await fusedSearch(notes, 'offsite venue', {})
  const withMemories = await fusedSearch(notes, 'offsite venue', {}, { memories })
  assert.equal(without[0].path, 'b.md')
  assert.equal(withMemories[0].path, 'a.md')
  assert.equal(withMemories[0].claim, 'The offsite venue is Waiheke.')
  assert.equal(withMemories[1].claim, undefined)
})

test('fusedSearch: a temporal-only query never consults the memory stage', async () => {
  const notes = toRetrieval([note('a.md', '---\ntitle: A\n---\nx', Date.UTC(2026, 7, 20))])
  const memories: MemoryStage = { rank: async () => assert.fail('must not run') }
  const hits = await fusedSearch(notes, 'what happened last week', {}, { memories, now: Date.UTC(2026, 7, 25) })
  assert.equal(hits.length, 1)
})
