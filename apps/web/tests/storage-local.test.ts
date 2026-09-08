// The local storage driver: a folder standing in for the buckets outside
// production, with the same contract — save, read back with its content type,
// list under a prefix, delete, and a signed URL that is a bearer for one
// object until it expires.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as store from '../lib/storage/localStore'

// The root is read per call, so setting it here is enough.
process.env.AUTH_SECRET = 'a-secret-long-enough-to-sign-local-storage-urls-with'
process.env.STORAGE_LOCAL_DIR = mkdtempSync(path.join(tmpdir(), 'visvine-storage-'))

test.after(() => {
  rmSync(process.env.STORAGE_LOCAL_DIR!, { recursive: true, force: true })
})

test('an object round-trips with its content type, and a miss is null', async () => {
  await store.localSave('media', 'space-1/media/p/original.webp', Buffer.from('webp!'), 'image/webp')
  const got = await store.localRead('media', 'space-1/media/p/original.webp')
  assert.equal(got?.bytes.toString(), 'webp!')
  assert.equal(got?.contentType, 'image/webp')
  assert.equal(await store.localRead('media', 'space-1/nothing.webp'), null)
})

test('listing walks a prefix and never shows the content-type sidecar', async () => {
  await store.localSave('resources', 'space-1/a.pdf', Buffer.from('a'), 'application/pdf')
  await store.localSave('resources', 'space-1/deep/b.csv', Buffer.from('bb'), 'text/csv')
  await store.localSave('resources', 'space-2/c.pdf', Buffer.from('c'), 'application/pdf')
  const names = (await store.localList('resources', 'space-1/')).map((o) => o.name).sort()
  assert.deepEqual(names, ['space-1/a.pdf', 'space-1/deep/b.csv'])
  const sizes = Object.fromEntries((await store.localList('resources')).map((o) => [o.name, o.sizeBytes]))
  assert.equal(sizes['space-1/deep/b.csv'], 2)
  await store.localDelete('resources', 'space-1/a.pdf')
  assert.equal(await store.localRead('resources', 'space-1/a.pdf'), null)
  assert.ok(!(await store.localList('resources')).some((o) => o.name === 'space-1/a.pdf'))
  await store.localDelete('resources', 'never-there.pdf')
})

test('a path cannot climb out of its bucket', async () => {
  await assert.rejects(store.localSave('media', '../escape.txt', Buffer.from('x'), 'text/plain'), /escapes its bucket/)
})

test('a signed URL verifies until it expires, and for that object only', () => {
  const expires = Date.now() + 60_000
  const url = new URL(store.localSignedUrl('resources', 'space-1/deep/b.csv', expires), 'http://localhost')
  assert.equal(url.pathname, '/api/storage/local/resources/space-1/deep/b.csv')
  const exp = url.searchParams.get('exp')
  const sig = url.searchParams.get('sig')
  assert.ok(store.verifyLocalSignature('resources', 'space-1/deep/b.csv', exp, sig))
  assert.ok(!store.verifyLocalSignature('resources', 'space-2/c.pdf', exp, sig))
  assert.ok(!store.verifyLocalSignature('media', 'space-1/deep/b.csv', exp, sig))
  assert.ok(!store.verifyLocalSignature('resources', 'space-1/deep/b.csv', exp, sig!.replace(/.$/, (c) => (c === '0' ? '1' : '0'))))
  const past = Date.now() - 1
  const stale = new URL(store.localSignedUrl('resources', 'space-1/deep/b.csv', past), 'http://localhost')
  assert.ok(!store.verifyLocalSignature('resources', 'space-1/deep/b.csv', stale.searchParams.get('exp'), stale.searchParams.get('sig')))
  assert.ok(!store.verifyLocalSignature('resources', 'space-1/deep/b.csv', null, null))
})
