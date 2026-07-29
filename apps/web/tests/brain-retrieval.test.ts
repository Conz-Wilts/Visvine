// Unit tests for the brain retrieval stack: BM25 text ranking and the fused
// search (filters → BM25 → optional vector stage → context expansion → RRF).
// Fixtures go through the real index pipeline (buildNoteIndex) rather than
// hand-rolled metas. Run: node --import tsx --test tests/brain-retrieval.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { bm25Search } from '../lib/notes/shared/bm25'
import {
  fusedSearch,
  matchesFilters,
  type RetrievalNote,
  type SourceStage,
  type VectorStage,
} from '../lib/notes/shared/retrieval'
import { buildNoteIndex } from '../lib/notes/shared/context'
import { splitFrontmatter } from '../lib/notes/shared/markdown'
import type { RawNote } from '../lib/notes/shared/types'

const note = (path: string, content: string, mtime = 0): RawNote => ({ path, content, mtime })

/** Run raw notes through the real pipeline into RetrievalNotes. */
const toRetrieval = (raws: RawNote[]): RetrievalNote[] => {
  const metas = buildNoteIndex(raws)
  const bodyByPath = new Map(raws.map((r) => [r.path, splitFrontmatter(r.content).body]))
  return metas.map((meta) => ({ meta, body: bodyByPath.get(meta.path)! }))
}

// --- bm25 ------------------------------------------------------------------------

test('bm25Search boosts title hits above body-only hits', () => {
  const docs = [
    { path: 'b.md', title: 'Random', body: 'we held a meeting yesterday about lunch' },
    { path: 'a.md', title: 'Quarterly Meeting', body: 'agenda for the quarter and more' },
  ]
  const res = bm25Search(docs, 'meeting')
  assert.equal(res.length, 2)
  assert.equal(res[0].path, 'a.md') // title occurrence weighs 3× a body occurrence
})

test('bm25Search uses AND semantics, relaxing to OR when nothing matches all terms', () => {
  const docs = [
    { path: 'a.md', title: 'A', body: 'alpha beta gamma' },
    { path: 'b.md', title: 'B', body: 'alpha only here' },
  ]
  // strict AND: only a.md has both terms
  const strict = bm25Search(docs, 'alpha beta')
  assert.deepEqual(strict.map((r) => r.path), ['a.md'])
  // no doc has "zeta" → the OR fallback still surfaces the alpha docs
  const relaxed = bm25Search(docs, 'alpha zeta')
  assert.equal(relaxed.length, 2)
  assert.ok(relaxed.every((r) => ['a.md', 'b.md'].includes(r.path)))
})

test('bm25Search stems plurals both ways (companies↔company, meetings↔meeting)', () => {
  const docs = [{ path: 'a.md', title: 'A', body: 'the companies held a meeting' }]
  assert.equal(bm25Search(docs, 'company meetings').length, 1)
  assert.equal(bm25Search(docs, 'companies meeting').length, 1)
})

test('bm25Search returns a non-empty snippet around the matched terms', () => {
  const filler = 'lorem ipsum dolor sit amet '.repeat(30)
  const docs = [{ path: 'a.md', title: 'A', body: `${filler} the kubernetes cluster failed ${filler}` }]
  const [hit] = bm25Search(docs, 'kubernetes')
  assert.ok(hit.snippet.length > 0)
  assert.ok(hit.snippet.toLowerCase().includes('kubernetes'))
})

test('bm25Search returns [] for empty or token-less queries', () => {
  const docs = [{ path: 'a.md', title: 'A', body: 'anything at all' }]
  assert.deepEqual(bm25Search(docs, ''), [])
  assert.deepEqual(bm25Search(docs, '  !? .'), [])
})

// --- matchesFilters ----------------------------------------------------------------

const filterVault = (): RawNote[] => [
  note('deals/canva.md', '---\ntitle: Canva\ntype: deal\ntags: [Sales, q3]\n---\n\nBody.', 1_000),
  note('wiki/handbook.md', '---\ntitle: Handbook\ntype: doc\n---\n\nBody.', 2_000),
  note('welcome.md', '---\ntitle: Welcome\n---\n\nBody.', 3_000),
]

test('matchesFilters checks type, folderId, tags (case-insensitive AND), and mtime bounds', () => {
  const metas = buildNoteIndex(filterVault())
  const canva = metas.find((m) => m.path === 'deals/canva.md')!
  const handbook = metas.find((m) => m.path === 'wiki/handbook.md')!
  const welcome = metas.find((m) => m.path === 'welcome.md')!

  // no filters — everything matches
  assert.equal(matchesFilters(canva, {}), true)

  // type
  assert.equal(matchesFilters(canva, { type: 'deal' }), true)
  assert.equal(matchesFilters(handbook, { type: 'deal' }), false)

  // folderId ('' = root)
  assert.equal(matchesFilters(canva, { folderId: 'deals' }), true)
  assert.equal(matchesFilters(canva, { folderId: 'wiki' }), false)
  assert.equal(matchesFilters(welcome, { folderId: '' }), true)

  // tags: every tag must be present, case-insensitively
  assert.equal(matchesFilters(canva, { tags: ['SALES', 'Q3'] }), true)
  assert.equal(matchesFilters(canva, { tags: ['sales', 'q4'] }), false)

  // mtime bounds are inclusive
  assert.equal(matchesFilters(canva, { updatedAfter: 1_000 }), true)
  assert.equal(matchesFilters(canva, { updatedAfter: 1_001 }), false)
  assert.equal(matchesFilters(canva, { updatedBefore: 1_000 }), true)
  assert.equal(matchesFilters(canva, { updatedBefore: 999 }), false)
})

// --- fusedSearch --------------------------------------------------------------------

// alpha links to notes.md (its neighbor); beta is a weaker text hit; notes.md
// itself never matches the kubernetes queries by text.
const retrievalVault = (): RetrievalNote[] =>
  toRetrieval([
    note(
      'projects/alpha.md',
      '---\ntitle: Alpha\n---\n\nOur kubernetes deployment pipeline. See [runbook](notes.md).',
      1_000,
    ),
    note('projects/notes.md', '---\ntitle: Runbook\n---\n\nGrocery list: apples, flour, basil.', 2_000),
    note('projects/beta.md', '---\ntitle: Beta\n---\n\nkubernetes was mentioned once here.', 3_000),
  ])

test('fusedSearch (BM25 only) returns the expected top hit', async () => {
  const res = await fusedSearch(retrievalVault(), 'kubernetes deployment', {}, { contextExpand: false })
  assert.ok(res.length >= 1)
  assert.equal(res[0].path, 'projects/alpha.md')
  assert.equal(res[0].title, 'Alpha')
  assert.ok(res[0].snippet && res[0].snippet.includes('kubernetes'))
  // context expansion off → the text-unrelated neighbor never appears
  assert.ok(!res.some((r) => r.path === 'projects/notes.md'))
})

test('fusedSearch context expansion pulls in a linked neighbor of the top hits', async () => {
  const res = await fusedSearch(retrievalVault(), 'kubernetes deployment', {})
  assert.equal(res[0].path, 'projects/alpha.md')
  // notes.md matches no query term but is linked from the seed hit
  assert.ok(res.some((r) => r.path === 'projects/notes.md'))
})

test('fusedSearch lets a vector stage introduce and lift a result', async () => {
  const vector: VectorStage = {
    async rank(_query, docs) {
      // A fake embeddings stage that thinks the runbook is highly relevant.
      assert.ok(docs.some((d) => d.path === 'projects/notes.md')) // stage sees the candidate docs
      return [{ path: 'projects/notes.md', score: 0.93 }]
    },
  }
  const res = await fusedSearch(retrievalVault(), 'kubernetes', {}, { vector, contextExpand: false })
  const paths = res.map((r) => r.path)
  // the vector-only hit is fused in, and its rank-0 vector vote beats the
  // weaker (rank-1) BM25 hit
  assert.ok(paths.includes('projects/notes.md'))
  const bm25Hits = paths.filter((p) => p !== 'projects/notes.md')
  assert.equal(bm25Hits.length, 2) // alpha + beta still present
  assert.ok(paths.indexOf('projects/notes.md') < 2) // above the last text hit
})

test('fusedSearch degrades gracefully when the vector stage returns []', async () => {
  const emptyVector: VectorStage = { async rank() { return [] } }
  const withVector = await fusedSearch(retrievalVault(), 'kubernetes deployment', {}, {
    vector: emptyVector,
    contextExpand: false,
  })
  const withoutVector = await fusedSearch(retrievalVault(), 'kubernetes deployment', {}, {
    contextExpand: false,
  })
  assert.deepEqual(withVector.map((r) => r.path), withoutVector.map((r) => r.path))
  assert.equal(withVector[0].path, 'projects/alpha.md')
})

test('fusedSearch applies filters before ranking and honors k', async () => {
  const res = await fusedSearch(retrievalVault(), 'kubernetes', { updatedAfter: 2_500 }, {})
  assert.deepEqual(res.map((r) => r.path), ['projects/beta.md']) // alpha filtered out by mtime
  const capped = await fusedSearch(retrievalVault(), 'kubernetes', {}, { k: 1 })
  assert.equal(capped.length, 1)
})

// --- context-source stage -----------------------------------------------------------

const fakeSources = (hits: { path: string; seq: number; snippet: string; score: number }[]): SourceStage => ({
  async rank() {
    return hits
  },
})

test('fusedSearch fuses source-chunk hits alongside notes, typed as sources', async () => {
  const sources = fakeSources([
    { path: 'projects/pricing.csv', seq: 3, snippet: 'company: Acme; plan: kubernetes', score: 0.95 },
  ])
  const res = await fusedSearch(retrievalVault(), 'kubernetes', {}, { sources, contextExpand: false })
  const hit = res.find((r) => r.kind === 'source')
  assert.ok(hit, 'source hit fused in')
  assert.equal(hit.path, 'projects/pricing.csv')
  assert.equal(hit.seq, 3)
  assert.equal(hit.title, 'pricing.csv')
  assert.ok(hit.snippet?.includes('Acme'))
  // note hits keep their kind
  assert.ok(res.filter((r) => r.kind === 'note').length >= 1)
})

test('fusedSearch without a source stage (or with an empty one) is unchanged', async () => {
  const withEmpty = await fusedSearch(retrievalVault(), 'kubernetes deployment', {}, {
    sources: fakeSources([]),
    contextExpand: false,
  })
  const without = await fusedSearch(retrievalVault(), 'kubernetes deployment', {}, { contextExpand: false })
  assert.deepEqual(withEmpty.map((r) => r.path), without.map((r) => r.path))
  assert.ok(without.every((r) => r.kind === 'note'))
})

test('fusedSearch skips the source stage under note-frontmatter filters', async () => {
  let ranked = false
  const sources: SourceStage = {
    async rank() {
      ranked = true
      return [{ path: 'projects/pricing.csv', seq: 0, snippet: 'x', score: 0.9 }]
    },
  }
  const res = await fusedSearch(retrievalVault(), 'kubernetes', { type: 'Playbook' }, { sources })
  assert.equal(ranked, false) // type/tags are note concepts — sources sit out
  assert.ok(res.every((r) => r.kind === 'note'))
})

test('two chunks of the same source fuse as distinct results', async () => {
  const sources = fakeSources([
    { path: 'projects/pricing.csv', seq: 0, snippet: 'rows 0-19', score: 0.95 },
    { path: 'projects/pricing.csv', seq: 1, snippet: 'rows 20-39', score: 0.9 },
  ])
  const res = await fusedSearch(retrievalVault(), 'kubernetes', {}, { sources, contextExpand: false })
  const seqs = res.filter((r) => r.kind === 'source').map((r) => r.seq)
  assert.deepEqual(seqs.sort(), [0, 1])
})
