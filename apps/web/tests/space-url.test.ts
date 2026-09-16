import test from 'node:test'
import assert from 'node:assert/strict'
import {
  inSpace,
  isCanonicalSpaceUrl,
  isSpaceRouteName,
  isSpaceScopedPath,
  parseSpacePath,
  sameSectionIn,
  spaceUrlPrefix,
  stripSpacePrefix,
  withSpace,
} from '../lib/spaces/shared/spaceUrl'
import { isReservedSpaceId } from '../lib/spaces/shared/global'

test('a space URL names the space and the page', () => {
  assert.deepEqual(parseSpacePath('/s/acme/directory/note/digests/index.md'), {
    houseId: 'acme',
    roomId: null,
    spaceId: 'acme',
    rest: '/directory/note/digests/index.md',
  })
})

test('the segment after the house is a room unless it is a page', () => {
  assert.deepEqual(parseSpacePath('/s/acme/growth/events/e1'), {
    houseId: 'acme',
    roomId: 'growth',
    spaceId: 'growth',
    rest: '/events/e1',
  })
  assert.equal(parseSpacePath('/s/acme/events')?.roomId, null)
})

test('a space URL with no page lands on home', () => {
  assert.equal(parseSpacePath('/s/acme')?.rest, '/home')
  assert.equal(parseSpacePath('/s/acme/')?.rest, '/home')
  assert.equal(parseSpacePath('/s/acme/growth')?.rest, '/home')
  assert.equal(parseSpacePath('/s/acme/growth')?.spaceId, 'growth')
})

test('what is not a space URL parses to nothing', () => {
  assert.equal(parseSpacePath('/directory'), null)
  assert.equal(parseSpacePath('/s/'), null)
  assert.equal(parseSpacePath('/s'), null)
  assert.equal(parseSpacePath('/spaces/acme'), null)
  assert.equal(parseSpacePath('/s/%E0%A4%A/directory'), null)
})

test('an encoded id round-trips', () => {
  const prefix = spaceUrlPrefix({ id: 'me:user_1' })
  assert.equal(prefix, '/s/me%3Auser_1')
  assert.equal(parseSpacePath(`${prefix}/directory`)?.spaceId, 'me:user_1')
})

test('stripping leaves the route', () => {
  assert.equal(stripSpacePrefix('/s/acme/growth/channels/c1'), '/channels/c1')
  assert.equal(stripSpacePrefix('/discover'), '/discover')
})

test('only space pages are scoped', () => {
  for (const path of ['/directory', '/directory?view=table', '/events/new', '/admin?section=tools', '/t/board', '/home', '/settings']) {
    assert.equal(isSpaceScopedPath(path), true, path)
  }
  for (const path of ['/spaces', '/spaces/acme', '/discover', '/e/launch', '/api/notes', '/signin', '/', '/directoryx', 'directory']) {
    assert.equal(isSpaceScopedPath(path), false, path)
  }
})

test('withSpace prefixes a space page and nothing else', () => {
  const room = { id: 'growth', parentId: 'acme' }
  assert.equal(withSpace('/directory?view=table', { id: 'acme' }), '/s/acme/directory?view=table')
  assert.equal(withSpace('/events/e1', room), '/s/acme/growth/events/e1')
  assert.equal(withSpace('/spaces/acme', room), '/spaces/acme')
  assert.equal(withSpace('/s/other/directory', room), '/s/other/directory')
  assert.equal(withSpace('https://example.com/directory', room), 'https://example.com/directory')
  assert.equal(withSpace('//evil.test/directory', room), '//evil.test/directory')
  assert.equal(withSpace('/directory', null), '/directory')
  assert.equal(inSpace('acme', '/t/board'), '/s/acme/t/board')
})

test('a switch keeps the section, never an id from the space being left', () => {
  const beta = { id: 'beta' }
  assert.equal(sameSectionIn('/s/acme/directory?view=table&type=person', beta), '/s/beta/directory?view=table&type=person')
  assert.equal(sameSectionIn('/s/acme/directory/person%3Acraig?tab=context', beta), '/s/beta/directory')
  assert.equal(sameSectionIn('/s/acme/admin?section=clean', beta), '/s/beta/admin?section=clean')
  assert.equal(sameSectionIn('/s/acme/events/e1', beta), '/s/beta/events')
  assert.equal(sameSectionIn('/s/acme/t/board', beta), '/s/beta/home')
  assert.equal(sameSectionIn('/spaces', beta), '/s/beta/home')
})

test('a room addressed without its house is not canonical', () => {
  const room = { id: 'growth', parentId: 'acme' }
  assert.equal(isCanonicalSpaceUrl(parseSpacePath('/s/acme/growth/home')!, room), true)
  assert.equal(isCanonicalSpaceUrl(parseSpacePath('/s/growth/home')!, room), false)
  assert.equal(isCanonicalSpaceUrl(parseSpacePath('/s/other/growth/home')!, room), false)
  assert.equal(isCanonicalSpaceUrl(parseSpacePath('/s/acme/home')!, { id: 'acme' }), true)
  assert.equal(isCanonicalSpaceUrl(parseSpacePath('/s/x/acme/home')!, { id: 'acme' }), false)
})

test('no space may take the name of a page', () => {
  assert.equal(isSpaceRouteName('events'), true)
  assert.equal(isSpaceRouteName('Directory'), true)
  assert.equal(isSpaceRouteName('growth'), false)
  assert.equal(isReservedSpaceId('events'), true)
  assert.equal(isReservedSpaceId('t'), true)
  assert.equal(isReservedSpaceId('growth'), false)
})
