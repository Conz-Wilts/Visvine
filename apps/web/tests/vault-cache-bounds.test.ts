import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { vaultFor, type VaultEntry } from '@/lib/notes/vaultCache'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import { LEVEL_EDIT, LEVEL_VIEW } from '@/lib/notes/shared/authz'
import { buildNoteIndex } from '@/lib/notes/shared/context'
import type { RawNote } from '@/lib/notes/shared/types'

/**
 * Memory bounds on the note vault.
 *
 * Retrieval assembles its candidate set in memory: every live note in a context,
 * bodies and all, is resident while anyone searches it (lib/notes/store.ts
 * `listRaw`). That is the real ceiling of the current retrieval design, and it
 * used to be guarded only by a cap on the NUMBER of cached contexts — which is
 * not a memory bound at all, since twenty small spaces and twenty large ones
 * count the same. These tests hold the two bounds that replaced it.
 */

const src = readFileSync(join(__dirname, '..', 'lib/notes/vaultCache.ts'), 'utf8')

function notes(count: number, body = 'x'): RawNote[] {
  return Array.from({ length: count }, (_, i) => ({
    path: `n${i}.md`,
    content: `---\ntitle: Note ${i}\n---\n${body}`,
    mtime: 1,
  }))
}

function entry(raws: RawNote[]): VaultEntry {
  let bytes = 0
  for (const r of raws) bytes += r.content.length
  return {
    raws,
    metas: buildNoteIndex(raws),
    bySig: new Map(),
    stamp: { count: raws.length, maxUpdatedMs: 1 },
    checkedAt: Date.now(),
    bytes,
  }
}

/** A non-admin shared-context viewer whose grants make their signature unique. */
function viewer(n: number): ContextPrincipal {
  return {
    userId: `u${n}`,
    email: `u${n}@x.dev`,
    name: `U${n}`,
    spaceId: 'sp',
    spaceAdmin: false,
    access: {
      grants: [
        { subjectType: 'user', subjectId: `u${n}`, resourcePath: `folder-${n}`, level: LEVEL_VIEW },
      ],
      restricted: [],
      locked: [],
    },
  }
}

test('the cache is bounded by bytes, not only by context count', () => {
  // A count cap cannot tell twenty small contexts from twenty large ones. The
  // byte budget is the bound that actually keeps an instance off an OOM.
  assert.match(src, /MAX_CACHE_BYTES/, 'the vault cache has no byte budget')
  assert.match(
    src,
    /cachedBytes\(\)\s*>\s*MAX_CACHE_BYTES/,
    'the eviction loop must consider bytes, not just cache.size',
  )
})

test('eviction never drops the entry it was just asked for', () => {
  // A single context larger than the whole budget must still be served;
  // evicting it on insert would rebuild it on every call, forever.
  assert.match(src, /oldest === key/, 'the LRU must refuse to evict the entry being inserted')
})

test('an oversized context is logged before it becomes a latency problem', () => {
  assert.match(src, /notes\.vault\.large_context/)
})

test('cached visibility views are capped per context', () => {
  // Each view shares the underlying note objects with the unfiltered corpus, so
  // one costs an array plus a rebuilt index — small, but the number of distinct
  // signatures in a space with per-note grants is bounded only by its membership.
  const e = entry(notes(5))
  for (let i = 0; i < 100; i++) vaultFor(e, viewer(i), { spaceId: 'sp', ownerKey: 'shared' })
  assert.ok(e.bySig.size > 0, 'views should be cached at all')
  assert.ok(
    e.bySig.size <= 32,
    `bySig grew to ${e.bySig.size} — the per-entry view cache is unbounded again`,
  )
})

test('the view cache keeps the most recently used signature', () => {
  const e = entry(notes(5))
  const first = viewer(0)
  const ctx = { spaceId: 'sp', ownerKey: 'shared' }
  vaultFor(e, first, ctx)
  // Push it out of insertion order by re-reading it, then overflow the cache.
  for (let i = 1; i < 20; i++) vaultFor(e, viewer(i), ctx)
  vaultFor(e, first, ctx) // touch — this must now be the newest
  for (let i = 20; i < 51; i++) vaultFor(e, viewer(i), ctx)

  const sig = 'r:' + JSON.stringify(['folder-0']) + '|x:' + JSON.stringify([])
  assert.ok(e.bySig.has(sig), 'a recently used view was evicted ahead of colder ones')
})

test('an unfiltered principal never populates the view cache', () => {
  // Super admins and personal contexts get the corpus as-is; caching a "view"
  // for them would be a second reference to the same array.
  const e = entry(notes(3))
  const admin: ContextPrincipal = {
    userId: 'a',
    email: 'a@x.dev',
    name: 'A',
    spaceId: 'sp',
    spaceAdmin: true,
    system: true,
    access: {
      grants: [{ subjectType: 'space', subjectId: '', resourcePath: '', level: LEVEL_EDIT }],
      restricted: [],
      locked: [],
    },
  }
  const view = vaultFor(e, admin, { spaceId: 'sp', ownerKey: 'a' })
  assert.equal(view.raws, e.raws, 'a personal context should be served the corpus by reference')
  assert.equal(e.bySig.size, 0)
})
