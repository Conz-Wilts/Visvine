// What may be uploaded: programs never, a file whose bytes contradict its name
// never, and markup that could run in a browser never drawn as a document.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isRenderableMarkup, refuseBySniff, refuseUploadByName } from '../lib/resources/shared/uploadPolicy'
import { configureScanner, scanUpload } from '../lib/resources/scan'

const MAX = 2_000_000_000

test('a program is refused by name, whatever its size', () => {
  for (const name of ['setup.exe', 'Install.DMG', 'run.sh', 'x.ps1', 'app.apk', 'tool.jar']) {
    assert.match(refuseUploadByName(name, 10, MAX) ?? '', /program/, name)
  }
  assert.equal(refuseUploadByName('deck.pdf', 10, MAX), null)
})

test('empty, nameless and oversized files are refused before a byte is stored', () => {
  assert.ok(refuseUploadByName('a.pdf', 0, MAX))
  assert.ok(refuseUploadByName('  ', 10, MAX))
  assert.match(refuseUploadByName('huge.mov', MAX + 1, MAX) ?? '', /at most 2,000 MB/)
})

test('bytes must agree with the name', () => {
  assert.equal(refuseBySniff('logo.png', 'image/png'), null)
  assert.equal(refuseBySniff('photo.jpg', 'image/webp'), null, 'an image is an image')
  assert.ok(refuseBySniff('logo.png', 'application/pdf'))
  assert.ok(refuseBySniff('report.pdf', 'application/x-msdownload'), 'a program in disguise')
  assert.ok(refuseBySniff('notes.txt', 'application/x-elf'))
})

test('office files are zip or OLE containers; text has no signature at all', () => {
  assert.equal(refuseBySniff('deck.pptx', 'application/zip'), null)
  assert.equal(refuseBySniff('budget.xls', 'application/x-cfb'), null)
  assert.ok(refuseBySniff('photo.png', 'application/zip'))
  assert.equal(refuseBySniff('data.csv', null), null)
  assert.equal(refuseBySniff('clip.m4a', 'video/mp4'), null, 'audio in a video container')
})

test('markup is never drawn as a document', () => {
  assert.equal(isRenderableMarkup('page.html', 'text/html'), false)
  assert.equal(isRenderableMarkup('logo.svg', 'image/svg+xml'), false)
  assert.equal(isRenderableMarkup('feed', 'application/rss+xml'), false)
  assert.equal(isRenderableMarkup('notes.md', 'text/markdown'), true)
})

test('with no scanner an upload is recorded as skipped, with one it is judged', async () => {
  assert.equal(await scanUpload('resources/s/r/x.pdf'), 'skipped')
  configureScanner({ scan: async (path) => (path.endsWith('eicar.txt') ? 'blocked' : 'clean') })
  try {
    assert.equal(await scanUpload('resources/s/r/eicar.txt'), 'blocked')
    assert.equal(await scanUpload('resources/s/r/fine.txt'), 'clean')
  } finally {
    configureScanner(null)
  }
})
