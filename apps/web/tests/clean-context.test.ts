// Unit tests for the pure half of the role-aware clean pass
// (lib/notes/shared/clean.ts): role scoping, worklist shaping, the setStale
// exclusions, and folder structure stats.
// Run: pnpm --filter @visvine/web exec node --import tsx --test tests/clean-context.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildCleanScope,
  scopeIssues,
  filterCleanFixes,
  folderStats,
  buildWorklist,
} from '../lib/notes/shared/clean'
import type { AutoFix, Issue } from '../lib/notes/shared/review'
import type { NoteMeta } from '../lib/notes/shared/types'

const meta = (path: string, over: Partial<NoteMeta> = {}): NoteMeta => ({
  path,
  title: path,
  folder: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
  frontmatter: {},
  tags: [],
  linkTargets: [],
  unresolved: [],
  mtime: 0,
  ...over,
})

const issue = (path: string, kind = 'schema'): Issue => ({ path, kind, detail: 'x' })

// ── buildCleanScope ──

test('a member reaches only owned ∩ target ∩ writable', () => {
  const scope = buildCleanScope({
    role: 'member',
    ownedPaths: new Set(['deals/mine.md', 'notes/also-mine.md']),
    targetPath: 'deals',
    canWrite: (p) => p !== 'deals/frozen-out.md',
  })
  assert.equal(scope.inScope('deals/mine.md'), true)
  assert.equal(scope.inScope('notes/also-mine.md'), false) // outside target
  assert.equal(scope.inScope('deals/theirs.md'), false) // not owned
})

test('admins and personal-space owners own everything under the target', () => {
  for (const role of ['admin', 'owner'] as const) {
    const scope = buildCleanScope({ role, targetPath: '', canWrite: () => true })
    assert.equal(scope.inScope('anything/at-all.md'), true, role)
  }
  const targeted = buildCleanScope({ role: 'admin', targetPath: 'people', canWrite: () => true })
  assert.equal(targeted.inScope('people/craig.md'), true)
  assert.equal(targeted.inScope('deals/acme.md'), false)
})

test('scopeIssues drops what the caller cannot act on', () => {
  const scope = buildCleanScope({
    role: 'member',
    ownedPaths: new Set(['a.md']),
    canWrite: () => true,
  })
  const scoped = scopeIssues([issue('a.md'), issue('b.md')], scope)
  assert.deepEqual(scoped.map((i) => i.path), ['a.md'])
})

// ── filterCleanFixes ──

test('setStale never fires on entity or index notes, other fixes pass through', () => {
  const fixes: AutoFix[] = [
    { kind: 'setStale', path: 'people/craig.md' }, // entity card — dropped
    { kind: 'setStale', path: 'deals/index.md' }, // index IS a folder — dropped
    { kind: 'setStale', path: 'journal/2025-01.md' }, // genuine stale note — kept
    { kind: 'addMissingFrontmatter', path: 'people/craig.md', fields: { type: 'note' } }, // non-stale fix on an entity — kept
  ]
  const kept = filterCleanFixes(fixes)
  assert.deepEqual(
    kept.map((f) => `${f.kind}:${f.path}`),
    ['setStale:journal/2025-01.md', 'addMissingFrontmatter:people/craig.md'],
  )
})

// ── folderStats ──

test('folderStats counts content notes, treats index-only folders as empty', () => {
  const metas = [
    meta('deals/acme.md', { tags: ['deal', 'active'], frontmatter: { type: 'Note' } }),
    meta('deals/globex.md', { tags: ['deal'], frontmatter: { type: 'Note' } }),
    meta('deals/index.md'),
    meta('archive/index.md'), // index stub only → empty
    meta('inbox/one.md'),
  ]
  const s = folderStats(metas, ['deals', 'archive', 'inbox'])
  const deals = s.perFolder.find((f) => f.path === 'deals')!
  assert.equal(deals.noteCount, 2)
  assert.deepEqual(deals.topTags, ['deal', 'active'])
  assert.deepEqual(deals.topTypes, ['Note'])
  assert.deepEqual(s.emptyFolders, ['archive'])
  assert.deepEqual(s.oneNoteFolders, ['inbox'])
  assert.deepEqual(s.largestFolders[0], { path: 'deals', noteCount: 2 })
})

test('folderStats attributes nested notes to every ancestor folder', () => {
  const metas = [meta('a/b/deep.md')]
  const s = folderStats(metas, ['a', 'a/b'])
  assert.equal(s.perFolder.find((f) => f.path === 'a')!.noteCount, 1)
  assert.equal(s.perFolder.find((f) => f.path === 'a/b')!.noteCount, 1)
})

// ── buildWorklist ──

test('worklist groups by kind, biggest first, caps items, attaches guidance', () => {
  const issues: Issue[] = [
    issue('a.md', 'orphan'),
    issue('b.md', 'orphan'),
    issue('c.md', 'orphan'),
    issue('d.md', 'duplicate'),
  ]
  const wl = buildWorklist(issues, 2)
  assert.deepEqual(wl.map((g) => g.kind), ['orphan', 'duplicate'])
  assert.equal(wl[0].count, 3)
  assert.equal(wl[0].items.length, 2) // capped
  assert.match(wl[0].items[0].suggested_action.hint, /leading-slash/)
  assert.match(wl[1].items[0].suggested_action.tool, /clean_context/)
})

test('unknown issue kinds get the default edit_context guidance', () => {
  const wl = buildWorklist([issue('x.md', 'novel-kind')], 5)
  assert.equal(wl[0].items[0].suggested_action.tool, 'edit_context')
})

// ── lockedDenial: the "Freeze for AI" write gate ──

import { lockedDenial } from '../lib/notes/contextService'
import { OPEN_ACCESS, LEVEL_EDIT } from '../lib/notes/shared/authz'
import type { ContextPrincipal } from '../lib/notes/shared/contextTypes'

const SHARED = { spaceId: 'c1', ownerKey: 'shared' }
const PERSONAL = { spaceId: 'me:u1', ownerKey: 'shared' }

const principal = (locked: string[]): ContextPrincipal => ({
  userId: 'u1',
  email: 'u1@x.dev',
  name: 'U One',
  spaceId: 'c1',
  spaceAdmin: true, // the lock binds even admins' AI writes — it is about origin, not rank
  access: {
    grants: [{ subjectType: 'space', subjectId: '', resourcePath: '', level: LEVEL_EDIT }],
    restricted: [],
    locked,
  },
})

test('locked folders refuse autonomous AI origins, in the whole subtree', () => {
  const p = principal(['frozen'])
  for (const origin of ['agent', 'ai-enrich', 'maintenance'] as const) {
    assert.match(lockedDenial(p, SHARED, 'frozen/deep/note.md', origin)!, /frozen for AI/, origin)
  }
  assert.equal(lockedDenial(p, SHARED, 'open/note.md', 'agent'), null)
})

test('human origins pass through locked folders', () => {
  const p = principal(['frozen'])
  for (const origin of ['edit', 'restore', 'ai-refactor'] as const) {
    assert.equal(lockedDenial(p, SHARED, 'frozen/note.md', origin), null, origin)
  }
})

test('personal contexts are never lock-gated', () => {
  const p: ContextPrincipal = { ...principal([]), access: OPEN_ACCESS }
  assert.equal(lockedDenial(p, PERSONAL, 'anything.md', 'agent'), null)
})

// ── agents/: structurally frozen for AI, activation admin-only ──

import { writeDenial } from '../lib/notes/contextService'

test('agents/ refuses AI origins with no lock at all', () => {
  const p = principal([])
  for (const origin of ['agent', 'ai-enrich', 'maintenance'] as const) {
    assert.match(lockedDenial(p, SHARED, 'agents/digest/index.md', origin)!, /Agent briefs are frozen/, origin)
    assert.match(lockedDenial(p, SHARED, 'agents/digest/activation.md', origin)!, /Agent briefs are frozen/, origin)
    assert.match(lockedDenial(p, SHARED, 'agents/digest/report.md', origin)!, /Agent briefs are frozen/, origin)
  }
  // Humans author briefs normally.
  assert.equal(lockedDenial(p, SHARED, 'agents/digest/index.md', 'edit'), null)
  assert.equal(lockedDenial(p, SHARED, 'agents/digest/index.md', 'restore'), null)
})

test('an agent may write its OWN folder — never its brief, its activation or a sibling', () => {
  const p = principal([])
  const own = (path: string) => lockedDenial(p, SHARED, path, 'agent', 'agent:digest')
  assert.equal(own('agents/digest/report.md'), null)
  assert.equal(own('agents/digest/2026-01-31.md'), null)
  assert.equal(own('agents/digest/state.md'), null)
  assert.match(own('agents/digest/index.md')!, /frozen/)
  assert.match(own('agents/digest/activation.md')!, /frozen/)
  assert.match(own('agents/other/report.md')!, /frozen/)
  assert.match(own('agents/digest/deep/note.md')!, /frozen/, 'no sub-folders of its own')
  assert.match(own('agents/index.md')!, /frozen/)
  // The stamp is what opens the door: the same path under another origin, or
  // with no agent stamp, stays shut.
  assert.match(lockedDenial(p, SHARED, 'agents/digest/report.md', 'agent', 'mcp')!, /frozen/)
  assert.match(lockedDenial(p, SHARED, 'agents/digest/report.md', 'maintenance', 'agent:digest')!, /frozen/)
})

test('the activation follows the folder: a member who can edit the brief can turn it on', () => {
  const member: ContextPrincipal = { ...principal([]), spaceAdmin: false }
  const admin: ContextPrincipal = { ...principal([]), spaceAdmin: true }
  const system: ContextPrincipal = { ...member, system: true }
  assert.equal(writeDenial(member, SHARED, 'agents/digest/index.md'), null, 'the brief is member-writable')
  assert.equal(writeDenial(member, SHARED, 'agents/digest/report.md'), null, 'so is the rest of the folder')
  assert.equal(writeDenial(member, SHARED, 'agents/digest/activation.md'), null, 'and so is the activation')
  assert.equal(writeDenial(admin, SHARED, 'agents/digest/activation.md'), null)
  assert.equal(writeDenial(system, SHARED, 'agents/digest/activation.md'), null, 'the machine deactivation write')
})
