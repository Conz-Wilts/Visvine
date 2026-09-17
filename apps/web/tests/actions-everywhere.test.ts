// search_context with no space: the fold of one search per space into one
// answer, where every hit says which space it was read in and a room the
// caller belongs to is never counted twice.
//
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/actions-everywhere.test.ts

import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_SEARCH_SPACES, fuseAcrossSpaces, searchFanout } from '@/lib/actions/shared/everywhere'

const house = { id: 'acme', name: 'Acme', parent_id: null }
const room = { id: 'growth', name: 'Growth', parent_id: 'acme' }
const other = { id: 'club', name: 'Club', parent_id: null }

test('every hit carries the space it was read in, ranked by score across spaces', () => {
  const hits = fuseAcrossSpaces(
    [
      { space: house, hits: [{ path: 'a.md', title: 'A', score: 0.5, kind: 'note' }] },
      { space: other, hits: [{ path: 'b.md', title: 'B', score: 0.9, kind: 'note' }] },
    ],
    ['acme', 'club'],
  )
  assert.deepEqual(
    hits.map((h) => [h.space.id, h.path]),
    [
      ['club', 'b.md'],
      ['acme', 'a.md'],
    ],
  )
})

test('a room the caller is in is searched directly, so the house hop into it is dropped', () => {
  const hits = fuseAcrossSpaces(
    [
      {
        space: house,
        hits: [
          { path: 'subspaces/growth/plan.md', title: 'Plan', score: 0.8, kind: 'note' },
          { path: 'subspaces/design/brief.md', title: 'Brief', score: 0.7, kind: 'note' },
        ],
      },
      { space: room, hits: [{ path: 'plan.md', title: 'Plan', score: 0.8, kind: 'note' }] },
    ],
    ['acme', 'growth'],
  )
  assert.deepEqual(
    hits.map((h) => [h.space.id, h.path]),
    [
      ['growth', 'plan.md'],
      // A room the caller is NOT in is reached only through the house.
      ['acme', 'subspaces/design/brief.md'],
    ],
  )
})

test('k caps the fused list, not each space', () => {
  const hits = fuseAcrossSpaces(
    [
      { space: house, hits: [1, 2, 3].map((n) => ({ path: `${n}.md`, title: '', score: n, kind: 'note' as const })) },
      { space: other, hits: [4, 5].map((n) => ({ path: `${n}.md`, title: '', score: n, kind: 'note' as const })) },
    ],
    ['acme', 'club'],
    2,
  )
  assert.deepEqual(hits.map((h) => h.score), [5, 4])
})

test('fan-out is capped and reports what did not fit', () => {
  const spaces = Array.from({ length: MAX_SEARCH_SPACES + 3 }, (_, i) => ({ id: `s${i}` }))
  const { searched, skipped } = searchFanout(spaces)
  assert.equal(searched.length, MAX_SEARCH_SPACES)
  assert.equal(skipped, 3)
  assert.deepEqual(searchFanout([{ id: 'a' }]), { searched: [{ id: 'a' }], skipped: 0 })
})
