/**
 * Live data for Tools: the per-process note change bus (lib/notes/changes.ts),
 * how the store hooks feed it (lib/tools/hooks.ts), and the filter that decides
 * which paths a given Tool frame may hear about (lib/tools/changes.ts).
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-changes.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { changeSubscriberCount, publishChange, subscribeChanges, type NoteChange } from '@/lib/notes/changes'
import { toolNoteDeleted, toolNoteRenamed, toolNoteWritten } from '@/lib/tools/hooks'
import { changedPathsFor } from '@/lib/tools/changes'
import { createStreamCounter, MAX_STREAMS_PER_USER } from '@/lib/tools/streamLimit'
import { EMPTY_PERIMETER, type ToolPerimeter } from '@/lib/tools/perimeter'
import type { ResolvedTarget } from '@/lib/tools/target'
import { OPEN_ACCESS, LEVEL_VIEW, type ContextAccess } from '@/lib/notes/shared/authz'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import { pathsMatch } from '@/features/tools/kit/hooks'

// ── fixtures ──

function principal(access: ContextAccess = OPEN_ACCESS): ContextPrincipal {
  return { userId: 'user-1', email: 'viewer@local.dev', name: 'Viewer', spaceId: 'space-1', spaceAdmin: false, access }
}

function perimeter(over: Partial<ToolPerimeter> = {}): ToolPerimeter {
  return { ...EMPTY_PERIMETER, read: [], write: [], types: [], connectors: [], agents: [], ...over }
}

function target(over: Partial<ResolvedTarget> = {}): ResolvedTarget {
  const p = over.perimeter ?? perimeter({ read: ['deals/**'] })
  return {
    spaceId: 'space-1',
    principal: principal(),
    context: { spaceId: 'space-1', ownerKey: 'shared' },
    perimeter: p,
    config: {
      name: 'deals',
      title: 'Deals',
      description: '',
      version: 1,
      surfaces: { rail: null, types: [] },
      perimeter: p,
      tags: [],
      previewUrl: null,
    },
    dataBundle: '',
    installId: 'install-1',
    degraded: null,
    install: { slug: 'deals', title: 'Deals', key: 'space-1/deals' },
    isAdmin: false,
    subject: null,
    ...over,
  }
}

function change(over: Partial<NoteChange> = {}): NoteChange {
  return { spaceId: 'space-1', ownerKey: 'shared', path: 'deals/acme.md', kind: 'write', ...over }
}

// ── the bus ──

test('publish reaches every subscriber of the space and nobody else', () => {
  const a: NoteChange[] = []
  const b: NoteChange[] = []
  const other: NoteChange[] = []
  const offA = subscribeChanges('space-1', (c) => a.push(c))
  const offB = subscribeChanges('space-1', (c) => b.push(c))
  const offOther = subscribeChanges('space-2', (c) => other.push(c))
  assert.equal(changeSubscriberCount('space-1'), 2)

  publishChange(change())
  assert.equal(a.length, 1)
  assert.equal(b.length, 1)
  assert.equal(other.length, 0)

  offA()
  publishChange(change({ path: 'deals/b.md' }))
  assert.equal(a.length, 1)
  assert.equal(b.length, 2)

  offB()
  offOther()
  assert.equal(changeSubscriberCount('space-1'), 0)
  assert.equal(changeSubscriberCount('space-2'), 0)
  // Publishing into an empty space is a no-op, not an error.
  publishChange(change())
})

test('a throwing subscriber does not stop delivery to the others', () => {
  const seen: string[] = []
  const off1 = subscribeChanges('space-1', () => {
    throw new Error('boom')
  })
  const off2 = subscribeChanges('space-1', (c) => seen.push(c.path))
  publishChange(change())
  assert.deepEqual(seen, ['deals/acme.md'])
  off1()
  off2()
})

// ── the feed ──

test('the store hooks publish write, rename and delete — for personal contexts too', async () => {
  const seen: NoteChange[] = []
  const off = subscribeChanges('space-1', (c) => seen.push(c))
  try {
    await toolNoteWritten({ spaceId: 'space-1', ownerKey: 'shared' }, 'deals/acme.md')
    await toolNoteRenamed({ spaceId: 'space-1', ownerKey: 'shared' }, 'deals/old.md', 'deals/new.md')
    await toolNoteDeleted({ spaceId: 'space-1', ownerKey: 'user-9' }, 'journal/today.md')
    // A rename to itself is not a change.
    await toolNoteRenamed({ spaceId: 'space-1', ownerKey: 'shared' }, 'deals/same.md', 'deals/same.md')
  } finally {
    off()
  }
  assert.deepEqual(seen, [
    { spaceId: 'space-1', ownerKey: 'shared', path: 'deals/acme.md', kind: 'write' },
    { spaceId: 'space-1', ownerKey: 'shared', path: 'deals/new.md', kind: 'rename', from: 'deals/old.md' },
    { spaceId: 'space-1', ownerKey: 'user-9', path: 'journal/today.md', kind: 'delete' },
  ])
})

// ── the filter ──

test('only shared-context changes inside the read perimeter are forwarded', () => {
  const t = target()
  assert.deepEqual(changedPathsFor(t, change()), ['deals/acme.md'])
  assert.deepEqual(changedPathsFor(t, change({ path: 'salaries/pay.md' })), [], 'outside the perimeter')
  assert.deepEqual(changedPathsFor(t, change({ ownerKey: 'user-1' })), [], 'a personal note, even the viewer’s own')
  assert.deepEqual(changedPathsFor(t, change({ spaceId: 'space-2' })), [], 'another space')
})

test('a rename reports both ends when both are in the perimeter, and only the visible one otherwise', () => {
  const t = target({ perimeter: perimeter({ read: ['deals/**'] }) })
  assert.deepEqual(
    changedPathsFor(t, change({ kind: 'rename', path: 'deals/new.md', from: 'deals/old.md' })),
    ['deals/new.md', 'deals/old.md'],
  )
  assert.deepEqual(
    changedPathsFor(t, change({ kind: 'rename', path: 'deals/new.md', from: 'archive/old.md' })),
    ['deals/new.md'],
  )
  assert.deepEqual(
    changedPathsFor(t, change({ kind: 'rename', path: 'archive/new.md', from: 'deals/old.md' })),
    ['deals/old.md'],
  )
})

test('a path the viewer cannot read is dropped — its delete and rename-from too', () => {
  // The viewer may see deals/** but the space has restricted deals/secret/**.
  const access: ContextAccess = {
    grants: [{ subjectType: 'space', subjectId: '', resourcePath: '', level: LEVEL_VIEW }],
    restricted: ['deals/secret'],
    locked: [],
  }
  const t = target({ principal: principal(access), perimeter: perimeter({ read: ['deals/**'] }) })
  assert.deepEqual(changedPathsFor(t, change({ path: 'deals/open.md' })), ['deals/open.md'])
  assert.deepEqual(changedPathsFor(t, change({ path: 'deals/secret/plan.md' })), [])
  // Gone or not, the name of a note the viewer could never read is not theirs to hear.
  assert.deepEqual(changedPathsFor(t, change({ path: 'deals/secret/plan.md', kind: 'delete' })), [])
  assert.deepEqual(
    changedPathsFor(t, change({ kind: 'rename', path: 'deals/open.md', from: 'deals/secret/plan.md' })),
    ['deals/open.md'],
  )
  assert.deepEqual(changedPathsFor(t, change({ path: 'deals/open.md', kind: 'delete' })), ['deals/open.md'])
})

test('a Tool with no read perimeter hears nothing', () => {
  const t = target({ perimeter: perimeter() })
  assert.deepEqual(changedPathsFor(t, change()), [])
})

// ── the kit's glob matcher for useLiveQuery ──

test('pathsMatch: no patterns matches anything; globs match like the perimeter does', () => {
  assert.equal(pathsMatch(undefined, ['x.md']), true)
  assert.equal(pathsMatch([], ['x.md']), true)
  assert.equal(pathsMatch(['deals/**'], ['deals/acme.md']), true)
  assert.equal(pathsMatch(['deals/**'], ['deals/a/b/c.md']), true)
  assert.equal(pathsMatch(['deals/**'], ['people/ada.md']), false)
  assert.equal(pathsMatch(['deals/*.md'], ['deals/acme.md']), true)
  assert.equal(pathsMatch(['deals/*.md'], ['deals/a/b.md']), false)
  assert.equal(pathsMatch(['people/*/index.md'], ['people/ada/index.md']), true)
  assert.equal(pathsMatch(['**/index.md'], ['index.md']), true)
  assert.equal(pathsMatch(['**/index.md'], ['a/b/index.md']), true)
  assert.equal(pathsMatch(['deals/acme.md'], ['deals/acme.md']), true)
  assert.equal(pathsMatch(['deals/acme.md'], ['deals/acme.mdx']), false)
  assert.equal(pathsMatch(['deals/**', 'people/**'], ['people/ada.md']), true)
  assert.equal(pathsMatch(['deals/(x).md'], ['deals/(x).md']), true, 'regex metacharacters are literal')
})

// ── the per-user cap on open streams (lib/tools/streamLimit.ts) ──

test('a user may hold MAX_STREAMS_PER_USER streams; the next is refused; release gives the slot back', () => {
  const counter = createStreamCounter(3)
  assert.equal(counter.acquire('u1'), true)
  assert.equal(counter.acquire('u1'), true)
  assert.equal(counter.acquire('u1'), true)
  assert.equal(counter.acquire('u1'), false, 'the fourth is refused')
  assert.equal(counter.count('u1'), 3)
  // Another user is counted on their own.
  assert.equal(counter.acquire('u2'), true)
  counter.release('u1')
  assert.equal(counter.acquire('u1'), true)
  // Releasing to zero forgets the user; over-release never goes negative.
  counter.release('u2')
  counter.release('u2')
  assert.equal(counter.count('u2'), 0)
  assert.equal(counter.acquire('u2'), true)
  assert.equal(MAX_STREAMS_PER_USER, 8)
})
