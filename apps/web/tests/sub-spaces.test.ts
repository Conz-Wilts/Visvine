import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_SPACE_DEPTH,
  canSeeSpace,
  childrenFirst,
  defaultVisibility,
  joinChildDenial,
  parentDenial,
  normalizePublicName,
  spacePath,
  visibilityDenial,
} from '../lib/spaces/hierarchy'
import {
  childSpaceNodeId,
  entityDraftContent,
  entityFolderPathOf,
  entityIndexPathOf,
  entityNotePath,
  entityNotePaths,
  isChildSpaceNode,
} from '../lib/notes/entities'
import { parseFrontmatter } from '../lib/notes/shared/markdown'

test('a child defaults to inherit, a root to private', () => {
  assert.equal(defaultVisibility('blackbird'), 'inherit')
  assert.equal(defaultVisibility(null), 'private')
})

test('a root cannot inherit; a public child needs a public parent', () => {
  assert.ok(visibilityDenial('inherit', null))
  assert.equal(visibilityDenial('private', null), null)
  assert.equal(visibilityDenial('public', null), null)
  assert.ok(visibilityDenial('public', { visibility: 'private' }))
  assert.equal(visibilityDenial('public', { visibility: 'public' }), null)
  assert.equal(visibilityDenial('inherit', { visibility: 'private' }), null)
})

test('personal, global and too-deep parents refuse children', () => {
  assert.ok(parentDenial({ personalOwnerId: 'u1', isGlobal: false, depth: 1 }))
  assert.ok(parentDenial({ personalOwnerId: null, isGlobal: true, depth: 1 }))
  assert.ok(parentDenial({ personalOwnerId: null, isGlobal: false, depth: MAX_SPACE_DEPTH }))
  assert.equal(parentDenial({ personalOwnerId: null, isGlobal: false, depth: MAX_SPACE_DEPTH - 1 }), null)
})

test('inherit is visible through parent membership only', () => {
  const none = { member: false, parentMember: false }
  const viaParent = { member: false, parentMember: true }
  assert.equal(canSeeSpace('inherit', none), false)
  assert.equal(canSeeSpace('inherit', viaParent), true)
  assert.equal(canSeeSpace('private', viaParent), false)
  assert.equal(canSeeSpace('private', { member: true, parentMember: false }), true)
  assert.equal(canSeeSpace('public', none), true)
})

test('joining a child needs the parent joined, unless the parent is joinable', () => {
  assert.equal(joinChildDenial(null, false), null)
  assert.equal(joinChildDenial({ name: 'Blackbird', visibility: 'private' }, true), null)
  assert.equal(joinChildDenial({ name: 'Blackbird', visibility: 'public' }, false), null)
  assert.match(joinChildDenial({ name: 'Blackbird', visibility: 'private' }, false) ?? '', /Join Blackbird first/)
})

test('sibling names collide the way public names do', () => {
  assert.equal(normalizePublicName('  Finance   Team '), normalizePublicName('finance team'))
  assert.notEqual(normalizePublicName('Finance'), normalizePublicName('Finance Team'))
})

test('childrenFirst orders every space before its parent', () => {
  const order = childrenFirst([
    { id: 'root', parentId: null },
    { id: 'a', parentId: 'root' },
    { id: 'a1', parentId: 'a' },
    { id: 'b', parentId: 'root' },
  ])
  assert.ok(order.indexOf('a1') < order.indexOf('a'))
  assert.ok(order.indexOf('a') < order.indexOf('root'))
  assert.ok(order.indexOf('b') < order.indexOf('root'))
  assert.equal(order.length, 4)
})

test('spacePath walks root → leaf and survives a missing ancestor', () => {
  const byId = new Map([
    ['root', { id: 'root', parentId: null }],
    ['a', { id: 'a', parentId: 'root' }],
    ['orphan', { id: 'orphan', parentId: 'gone' }],
  ])
  assert.deepEqual(spacePath('a', byId).map((s) => s.id), ['root', 'a'])
  assert.deepEqual(spacePath('orphan', byId).map((s) => s.id), ['orphan'])
})

test("a space record's note names the space it stands for", () => {
  const content = entityDraftContent(
    { id: childSpaceNodeId('operations'), type: 'space', name: 'Operations', subtitle: null },
    { spaceRef: 'blackbird-operations' },
  )
  const fm = parseFrontmatter(content)
  assert.equal(fm.type, 'Space')
  assert.equal(fm.node, 'subspace:operations')
  assert.equal(fm.space, 'blackbird-operations')
  const person = entityDraftContent({ id: 'person:jo', type: 'person', name: 'Jo', subtitle: null }, {})
  assert.equal(parseFrontmatter(person).space, undefined)
})

test('a sub-space record is a folder at the root; an org record stays in communities/', () => {
  const team = { id: childSpaceNodeId('operations'), type: 'space' }
  assert.ok(isChildSpaceNode(team))
  // Folder-only, like a Tool: the folder IS the point, so there is no flat form
  // to convert from and only the index names the entity.
  assert.equal(entityNotePath(team), 'operations/index.md')
  assert.equal(entityIndexPathOf(team), 'operations/index.md')
  assert.equal(entityFolderPathOf(team), 'operations')
  assert.deepEqual(entityNotePaths(team), ['operations/index.md'])

  // A record of an organisation out in the world is untouched by any of this.
  const canva = { id: 'space:canva', type: 'space' }
  assert.ok(!isChildSpaceNode(canva))
  assert.equal(entityNotePath(canva), 'communities/canva.md')
  assert.deepEqual(entityNotePaths(canva), ['communities/canva.md', 'communities/canva/index.md'])
})
