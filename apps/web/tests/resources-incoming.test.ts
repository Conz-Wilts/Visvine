/**
 * A file arriving from an AI chat is named before the Drive decides what it is
 * (lib/resources/shared/incomingName.ts), and the upload token that carries it
 * names one person and one space, for minutes (lib/resources/uploadToken.ts).
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/resources-incoming.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { incomingFileName, incomingMimeType, sniffExtension } from '@/lib/resources/shared/incomingName'

process.env.AUTH_SECRET ||= 'test-secret-that-is-at-least-32-characters-long'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
const PDF = new TextEncoder().encode('%PDF-1.7')

test('a name with a known extension is kept', () => {
  assert.equal(incomingFileName('Launch poster.png', 'application/octet-stream', PDF), 'Launch poster.png')
  assert.equal(incomingFileName('brief.PDF', null, PNG), 'brief.PDF')
})

test('a bare name takes its extension from the declared type, then the bytes', () => {
  assert.equal(incomingFileName('logo', 'image/png', new Uint8Array()), 'logo.png')
  assert.equal(incomingFileName('poster', null, JPG), 'poster.jpg')
  assert.equal(incomingFileName('run sheet', 'application/octet-stream', PDF), 'run sheet.pdf')
  // A dotted name that is not an extension is still bare.
  assert.equal(incomingFileName('v2.final', null, PNG), 'v2.final.png')
})

test('no name at all is an upload, and paths never survive', () => {
  assert.equal(incomingFileName(null, 'image/webp', new Uint8Array()), 'upload.webp')
  assert.equal(incomingFileName('../../etc/passwd', null, new Uint8Array()), 'passwd')
  assert.equal(incomingFileName('a\u0000b.png', null, new Uint8Array()), 'ab.png')
})

test('the stored type follows the settled name when none was declared', () => {
  assert.equal(incomingMimeType('poster.jpg', null), 'image/jpeg')
  assert.equal(incomingMimeType('poster.jpeg', 'application/octet-stream'), 'image/jpeg')
  assert.equal(incomingMimeType('brief.pdf', 'application/pdf; charset=binary'), 'application/pdf')
  assert.equal(incomingMimeType('thing.xyz', null), 'application/octet-stream')
})

test('the signature reads the formats people send', () => {
  assert.equal(sniffExtension(PNG), '.png')
  assert.equal(sniffExtension(JPG), '.jpg')
  assert.equal(sniffExtension(PDF), '.pdf')
  assert.equal(sniffExtension(new TextEncoder().encode('RIFF\u0000\u0000\u0000\u0000WEBP')), '.webp')
  assert.equal(sniffExtension(new TextEncoder().encode('hello')), null)
})

test('an upload token names one person and one space, and nothing else verifies as one', async () => {
  const { mintUploadToken, verifyUploadToken } = await import('@/lib/resources/uploadToken')
  const { token, expiresAt } = await mintUploadToken({ userId: 'u1', spaceId: 's1', folder: null })
  assert.deepEqual(await verifyUploadToken(token), { userId: 'u1', spaceId: 's1', folder: null })
  assert.ok(expiresAt.getTime() > Date.now())

  const expired = await mintUploadToken({ userId: 'u1', spaceId: 's1', folder: 'resources/f1' }, -1)
  assert.equal(await verifyUploadToken(expired.token), null)

  // Tampering with a byte breaks it.
  assert.equal(await verifyUploadToken(token.slice(0, -2) + (token.endsWith('A') ? 'BB' : 'AA')), null)

  // A token of another audience, signed with the same key, is not an upload token.
  const { mintFrameToken } = await import('@/lib/tools/frameToken')
  const frame = await mintFrameToken({ kind: 'preview', viewerId: 'u1', spaceId: 's1', name: 'x' })
  assert.equal(await verifyUploadToken(frame), null)
})
