// The viewer draws what a browser can, and offers the rest as a file.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { imageSourceOf, rendererFor, showAsSource, type RenderableResource } from '../features/resources/viewer/registry'
import { clampScale, panBy, stepZoom, zoomAt, ZOOM } from '../../../packages/ui/src/resources/zoomMath'

function file(over: Partial<RenderableResource>): RenderableResource {
  return {
    kind: 'other', source: 'upload', name: 'x', mimeType: null, fileSize: 1000, width: null, height: null,
    embedUrl: null, rawUrl: '/api/resources/r/raw', previewUrl: null, page1Url: null, hasText: false, ...over,
  }
}

test('each kind reaches its renderer, and what browsers cannot draw is a file', () => {
  const cases: Array<[Partial<RenderableResource>, string]> = [
    [{ kind: 'image', name: 'logo.png' }, 'image'],
    [{ kind: 'image', name: 'photo.heic' }, 'unsupported'],
    [{ kind: 'image', name: 'photo.heic', previewUrl: '/p' }, 'image'],
    [{ kind: 'video', name: 'clip.mov' }, 'video'],
    [{ kind: 'video', name: 'clip.mkv' }, 'unsupported'],
    [{ kind: 'audio', name: 'call.m4a' }, 'audio'],
    [{ kind: 'pdf', name: 'deck.pdf' }, 'pdf'],
    [{ kind: 'doc', name: 'memo.docx' }, 'docx'],
    [{ kind: 'doc', name: 'memo.doc' }, 'unsupported'],
    [{ kind: 'sheet', name: 'q3.xlsx' }, 'sheet'],
    [{ kind: 'sheet', name: 'q3.numbers' }, 'unsupported'],
    [{ kind: 'slides', name: 'deck.pptx', page1Url: '/p1' }, 'slides'],
    [{ kind: 'slides', name: 'deck.key' }, 'unsupported'],
    [{ kind: 'text', name: 'notes.md' }, 'markdown'],
    [{ kind: 'text', name: 'run.log', fileSize: 5_000_000 }, 'unsupported'],
    [{ kind: 'code', name: 'page.html' }, 'text'],
    [{ kind: 'archive', name: 'x.zip' }, 'unsupported'],
    [{ kind: 'pdf', name: 'gone.pdf', rawUrl: null }, 'unsupported'],
    [{ source: 'link', kind: 'link', embedUrl: 'https://www.youtube-nocookie.com/embed/x' }, 'link-embed'],
    [{ source: 'link', kind: 'link' }, 'link-card'],
  ]
  for (const [over, want] of cases) assert.equal(rendererFor(file(over)), want, JSON.stringify(over))
})

test('an image is drawn from its original, so saving it saves the original', () => {
  assert.deepEqual(imageSourceOf(file({ kind: 'image', name: 'a.png', width: 4000, height: 3000, previewUrl: '/p' })), {
    src: '/api/resources/r/raw',
    isOriginal: true,
  })
  assert.deepEqual(imageSourceOf(file({ kind: 'image', name: 'huge.png', width: 12000, height: 9000, previewUrl: '/p' })), {
    src: '/p',
    isOriginal: false,
  })
  assert.equal(imageSourceOf(file({ kind: 'image', name: 'a.heic', previewUrl: '/p' }))?.isOriginal, false)
})

test('markup is shown as its source', () => {
  assert.equal(showAsSource({ name: 'page.html', mimeType: 'text/html' }), true)
  assert.equal(showAsSource({ name: 'readme.txt', mimeType: 'text/plain' }), false)
})

test('zoom steps in quarters, stops at its limits, and keeps the cursor’s point still', () => {
  let z = { scale: 1, x: 0, y: 0 }
  z = stepZoom(z, 1, ZOOM.maxImage)
  assert.equal(z.scale, 1.25)
  for (let i = 0; i < 10; i++) z = stepZoom(z, 1, ZOOM.maxImage)
  assert.equal(z.scale, 2, 'images stop at 200%')
  assert.equal(clampScale(0.01, 3), 0.25)
  const at = { x: 100, y: -40 }
  const zoomed = zoomAt({ scale: 2, x: 0, y: 0 }, 3, at, ZOOM.maxDocument)
  // The content point under the cursor: (at - translate) / scale, before and after.
  assert.deepEqual([(at.x - zoomed.x) / zoomed.scale, (at.y - zoomed.y) / zoomed.scale], [at.x / 2, at.y / 2])
  assert.deepEqual(zoomAt({ scale: 2, x: 50, y: 50 }, 1, at, 2), { scale: 1, x: 0, y: 0 }, 'fitting re-centres')
})

test('a pan never takes the content out of the pane', () => {
  const content = { width: 400, height: 300 }
  const pane = { width: 500, height: 400 }
  assert.deepEqual(panBy({ scale: 1, x: 0, y: 0 }, 50, 50, content, pane), { scale: 1, x: 0, y: 0 }, 'nothing to pan at fit')
  const panned = panBy({ scale: 2, x: 0, y: 0 }, 1000, -1000, content, pane)
  assert.deepEqual(panned, { scale: 2, x: 150, y: -100 })
})
