// Unit tests for the pure move preview (lib/notes/shared/movePreview.ts): what
// dropping a note or folder elsewhere does to who can see it. The route
// (app/api/notes/move-preview) is a thin wrapper that names the subjects.
// Run: node --import tsx --test tests/move-preview.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { LEVEL_EDIT, LEVEL_VIEW, type AccessGrant, type ContextAccess } from '../lib/notes/shared/authz'
import { moveAccessDiff, moveChangesAccess } from '../lib/notes/shared/movePreview'

// fixtures

const everyone = (resourcePath: string, level: number): AccessGrant => ({
  subjectType: 'space',
  subjectId: '',
  resourcePath,
  level,
})
const alias = (id: string, resourcePath: string, level: number): AccessGrant => ({
  subjectType: 'alias',
  subjectId: id,
  resourcePath,
  level,
})
const access = (grants: AccessGrant[], restricted: string[] = [], locked: string[] = []): ContextAccess => ({
  grants,
  restricted,
  locked,
})
const ids = (rows: Array<{ subjectType: string; subjectId: string }>) =>
  rows.map((r) => `${r.subjectType}:${r.subjectId}`).sort()

test('a move between folders with the same audience changes nothing', () => {
  const diff = moveAccessDiff(access([everyone('', LEVEL_EDIT)]), 'deals/a.md', 'sectors/a.md')
  assert.equal(moveChangesAccess(diff), false)
})

test('what the old folder granted is lost, what the new one grants is gained', () => {
  const a = access([alias('board', 'board', LEVEL_VIEW), alias('team', 'team', LEVEL_EDIT)])
  const diff = moveAccessDiff(a, 'board/minutes.md', 'team/minutes.md')
  assert.deepEqual(ids(diff.lost), ['alias:board'])
  assert.deepEqual(ids(diff.gained), ['alias:team'])
  assert.equal(moveChangesAccess(diff), true)
})

test('moving into a restricted folder cuts everyone granted outside it', () => {
  const a = access([everyone('', LEVEL_EDIT), alias('board', 'board', LEVEL_VIEW)], ['board'])
  const diff = moveAccessDiff(a, 'notes/plan.md', 'board/plan.md')
  assert.deepEqual(ids(diff.lost), ['space:'])
  assert.deepEqual(ids(diff.gained), ['alias:board'])
  assert.equal(diff.entersRestricted, 'board')
  assert.equal(diff.leavesRestricted, null)
})

test('moving out of a restricted folder opens the item to the new ancestors', () => {
  const a = access([everyone('', LEVEL_VIEW), alias('board', 'board', LEVEL_EDIT)], ['board'])
  const diff = moveAccessDiff(a, 'board/plan.md', 'plan.md')
  assert.deepEqual(ids(diff.gained), ['space:'])
  assert.deepEqual(ids(diff.lost), ['alias:board'])
  assert.equal(diff.leavesRestricted, 'board')
})

test("a grant on the item's own path follows it", () => {
  const a = access([alias('guest', 'deals/a.md', LEVEL_VIEW), everyone('', LEVEL_EDIT)])
  const diff = moveAccessDiff(a, 'deals/a.md', 'sectors/a.md')
  assert.equal(moveChangesAccess(diff), false)
})

test("the item's own restriction travels and is not reported as a boundary crossed", () => {
  const a = access([everyone('', LEVEL_EDIT), alias('me', 'deals/a.md', LEVEL_EDIT)], ['deals/a.md'])
  const diff = moveAccessDiff(a, 'deals/a.md', 'sectors/a.md')
  assert.equal(moveChangesAccess(diff), false)
})

test('a folder move re-prefixes grants held inside its subtree', () => {
  const a = access([alias('team', 'deals/q3', LEVEL_EDIT), everyone('archive', LEVEL_VIEW)])
  const diff = moveAccessDiff(a, 'deals', 'archive/deals')
  // Judged at the folder: nobody reached `deals` itself, everyone reaches it now.
  assert.deepEqual(ids(diff.gained), ['space:'])
  assert.deepEqual(diff.lost, [])
})

test('a level change is reported as changed, not as lost and gained', () => {
  const a = access([everyone('drafts', LEVEL_EDIT), everyone('published', LEVEL_VIEW)])
  const diff = moveAccessDiff(a, 'drafts/post.md', 'published/post.md')
  assert.deepEqual(diff.changed.map((c) => [c.before, c.after]), [[LEVEL_EDIT, LEVEL_VIEW]])
  assert.deepEqual(diff.gained, [])
  assert.deepEqual(diff.lost, [])
})

test('moving under a folder frozen for AI is a change', () => {
  const a = access([everyone('', LEVEL_EDIT)], [], ['legal'])
  const diff = moveAccessDiff(a, 'notes/nda.md', 'legal/nda.md')
  assert.equal(diff.lockedBefore, false)
  assert.equal(diff.lockedAfter, true)
  assert.equal(moveChangesAccess(diff), true)
})
