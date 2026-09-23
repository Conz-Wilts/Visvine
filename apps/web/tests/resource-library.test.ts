// The Resources list: one row per link, newest first, a page at a time.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { foldLibrary, linkKey, type LibraryItem } from '../lib/resources/shared/library'
import { messageFilesDenial } from '../lib/resources/shared/messageFiles'

function item(over: Partial<LibraryItem>): LibraryItem {
  return {
    key: 'file:x', kind: 'file', source: 'drive', name: 'x', fileType: 'pdf', fileSize: null,
    url: null, thumbUrl: null, faviconUrl: null, siteName: null, description: null, href: null,
    addedBy: null, channel: null, shares: 0, createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  }
}

function share(url: string, at: string, channel = 'general'): LibraryItem {
  return item({
    key: linkKey(url), kind: 'link', source: 'channel', name: 'Shared', url, fileType: null,
    channel: { id: channel, name: channel }, shares: 1, createdAt: at,
  })
}

test('a link shared many times is one row, counting its shares, dated by the newest', () => {
  const page = foldLibrary([
    share('https://a.test/x', '2026-09-01T00:00:00.000Z', 'general'),
    share('https://a.test/x?utm_source=feed', '2026-09-03T00:00:00.000Z', 'news'),
  ])
  assert.equal(page.items.length, 1)
  assert.equal(page.items[0].shares, 2)
  assert.equal(page.items[0].channel?.name, 'news')
  assert.equal(page.items[0].createdAt, '2026-09-03T00:00:00.000Z')
})

test('a link added as a resource wins the row and keeps its page', () => {
  const added = item({
    key: linkKey('https://a.test/x'), kind: 'link', source: 'added', name: 'The X article',
    url: 'https://a.test/x', fileType: null, href: '/directory/resource:x', createdAt: '2026-08-01T00:00:00.000Z',
  })
  const page = foldLibrary([share('https://a.test/x', '2026-09-03T00:00:00.000Z'), added])
  assert.equal(page.items.length, 1)
  assert.equal(page.items[0].name, 'The X article')
  assert.equal(page.items[0].href, '/directory/resource:x')
  assert.equal(page.items[0].shares, 1)
  assert.equal(page.items[0].channel?.name, 'general')
})

test('newest first; filters split files from links; search reads name, site and channel', () => {
  const items = [
    item({ key: 'file:1', name: 'Q3 report', createdAt: '2026-09-02T00:00:00.000Z' }),
    share('https://news.test/story', '2026-09-05T00:00:00.000Z', 'press'),
    item({ key: 'file:2', name: 'Logo', fileType: 'image', createdAt: '2026-09-04T00:00:00.000Z' }),
  ]
  assert.deepEqual(foldLibrary(items).items.map((i) => i.key), [linkKey('https://news.test/story'), 'file:2', 'file:1'])
  assert.deepEqual(foldLibrary(items, { filter: 'files' }).items.map((i) => i.key), ['file:2', 'file:1'])
  assert.equal(foldLibrary(items, { filter: 'links' }).items.length, 1)
  assert.deepEqual(foldLibrary(items, { q: 'q3 REPORT' }).items.map((i) => i.key), ['file:1'])
  assert.equal(foldLibrary(items, { q: 'press' }).items.length, 1)
})

test('a page is cut, and says where the next begins', () => {
  const items = Array.from({ length: 5 }, (_, i) =>
    item({ key: `file:${i}`, createdAt: `2026-09-0${i + 1}T00:00:00.000Z` }))
  const page = foldLibrary(items, { limit: 2 })
  assert.deepEqual(page.items.map((i) => i.key), ['file:4', 'file:3'])
  assert.equal(page.nextBefore, '2026-09-04T00:00:00.000Z')
  assert.equal(foldLibrary(items, { limit: 10 }).nextBefore, null)
})

test('a message carries only files its sender dropped into its own channel', () => {
  const sender = { userId: 'u1', conversationId: 'c1' }
  const mine = { id: 'r1', uploadedBy: 'u1', conversationId: 'c1' }
  assert.equal(messageFilesDenial(['r1'], [mine], sender), null)
  assert.ok(messageFilesDenial(['r2'], [{ id: 'r2', uploadedBy: 'u2', conversationId: 'c1' }], sender))
  assert.ok(messageFilesDenial(['r3'], [{ id: 'r3', uploadedBy: 'u1', conversationId: 'c2' }], sender))
  assert.ok(messageFilesDenial(['r4'], [{ id: 'r4', uploadedBy: 'u1', conversationId: null }], sender))
  assert.ok(messageFilesDenial(['missing'], [], sender))
  assert.ok(messageFilesDenial(Array.from({ length: 11 }, (_, i) => `r${i}`), [], sender))
})
