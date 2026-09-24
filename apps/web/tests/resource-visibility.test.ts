// Who sees a resource: the union of its shares, plus the admins — and the
// note's audience, the message-files gate and the download header that follow
// from it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canManageResource,
  canSeeResource,
  noteAudience,
  type ResourceViewer,
} from '../lib/resources/shared/visibility'
import { messageFilesDenial } from '../lib/resources/shared/messageFiles'
import { fileTypeOf, kindOf, RESOURCE_KINDS } from '../lib/resources/shared/kinds'
import { contentDisposition } from '../lib/resources/shared/disposition'

function viewer(over: Partial<ResourceViewer> = {}): ResourceViewer {
  return { userId: 'ana', admin: false, member: true, channelIds: new Set(['brand']), ...over }
}

const inSpace = { conversationId: null }
const inBrand = { conversationId: 'brand' }
const inOps = { conversationId: 'ops' }

test('a share to the space reaches every member', () => {
  const r = { createdBy: 'ben', deleted: false, shares: [inSpace] }
  assert.equal(canSeeResource(viewer({ channelIds: new Set() }), r), true)
})

test('a channel share reaches that channel’s members only', () => {
  const r = { createdBy: 'ben', deleted: false, shares: [inOps] }
  assert.equal(canSeeResource(viewer(), r), false)
  assert.equal(canSeeResource(viewer({ channelIds: new Set(['ops']) }), r), true)
})

test('any one share is enough: the union of shares', () => {
  const r = { createdBy: 'ben', deleted: false, shares: [inOps, inBrand] }
  assert.equal(canSeeResource(viewer(), r), true)
})

test('admins see everything; someone outside the space sees nothing', () => {
  const r = { createdBy: 'ben', deleted: false, shares: [inOps] }
  assert.equal(canSeeResource(viewer({ admin: true, channelIds: new Set() }), r), true)
  assert.equal(canSeeResource(viewer({ member: false }), { ...r, shares: [inSpace, inBrand] }), false)
})

test('shared nowhere, or trashed, it is its creator’s alone', () => {
  const orphan = { createdBy: 'ana', deleted: false, shares: [] }
  assert.equal(canSeeResource(viewer(), orphan), true)
  assert.equal(canSeeResource(viewer({ userId: 'ben' }), orphan), false)
  const trashed = { createdBy: 'ana', deleted: true, shares: [inSpace] }
  assert.equal(canSeeResource(viewer(), trashed), true)
  assert.equal(canSeeResource(viewer({ userId: 'ben' }), trashed), false)
})

test('only the creator or an admin manages a resource', () => {
  assert.equal(canManageResource(viewer(), { createdBy: 'ana' }), true)
  assert.equal(canManageResource(viewer(), { createdBy: 'ben' }), false)
  assert.equal(canManageResource(viewer({ admin: true }), { createdBy: 'ben' }), true)
})

test('the note’s audience follows the shares', () => {
  assert.deepEqual(noteAudience({ createdBy: 'ana', shares: [inBrand, inSpace] }), { open: true })
  assert.deepEqual(noteAudience({ createdBy: 'ana', shares: [inOps, inBrand, inOps] }), {
    open: false,
    channelIds: ['brand', 'ops'],
    userIds: [],
  })
  assert.deepEqual(noteAudience({ createdBy: 'ana', shares: [] }), { open: false, channelIds: [], userIds: ['ana'] })
})

test('a message carries resources its sender can see, from its own space', () => {
  const space = { spaceId: 's1' }
  assert.equal(messageFilesDenial(['r1'], [{ id: 'r1', spaceId: 's1', visible: true }], space), null)
  assert.ok(messageFilesDenial(['r2'], [{ id: 'r2', spaceId: 's1', visible: false }], space))
  assert.ok(messageFilesDenial(['r3'], [{ id: 'r3', spaceId: 's2', visible: true }], space))
  assert.ok(messageFilesDenial(['missing'], [], space))
  assert.ok(messageFilesDenial(['r1'], [{ id: 'r1', spaceId: 's1', visible: true }], { spaceId: null }))
  assert.ok(messageFilesDenial(Array.from({ length: 11 }, (_, i) => `r${i}`), [], space))
})

test('kind comes from the name, then the type', () => {
  assert.equal(kindOf('Logo.PNG'), 'image')
  assert.equal(kindOf('deck.pptx'), 'slides')
  assert.equal(kindOf('notes.md'), 'text')
  assert.equal(kindOf('data', 'text/csv'), 'sheet')
  assert.equal(kindOf('clip', 'video/mp4'), 'video')
  assert.equal(kindOf('mystery.bin'), 'other')
  assert.equal(fileTypeOf('Q3.xlsx'), 'xlsx')
  assert.equal(fileTypeOf('photo.heic'), 'image')
  for (const name of ['a.png', 'a.mov', 'a.mp3', 'a.pdf', 'a.docx', 'a.csv', 'a.key', 'a.txt', 'a.ts', 'a.zip']) {
    assert.ok(RESOURCE_KINDS.includes(kindOf(name)) && kindOf(name) !== 'other', name)
  }
})

test('a download keeps its exact name and cannot break the header', () => {
  const header = contentDisposition('Q3 résumé "final".pdf')
  assert.match(header, /^attachment; filename="Q3 r_sum_ _final_\.pdf"; filename\*=UTF-8''Q3%20r%C3%A9sum%C3%A9%20%22final%22\.pdf$/)
  assert.ok(!contentDisposition('a\r\nSet-Cookie: x').includes('\n'))
})
