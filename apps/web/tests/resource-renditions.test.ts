// A rendition is re-encoded from pixels: turned upright, fitted to its edge,
// and carrying none of the source's EXIF.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { encodeRendition } from '../lib/resources/renditions'

async function photoWithExif(): Promise<Buffer> {
  return sharp({ create: { width: 3000, height: 1000, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .withExifMerge({ IFD0: { Copyright: 'Ana', Artist: 'Ana' } })
    .toBuffer()
}

test('EXIF never survives into a rendition', async () => {
  const source = await photoWithExif()
  assert.ok((await sharp(source).metadata()).exif, 'the fixture carries EXIF')
  const { data } = await encodeRendition(source, 'thumb')
  const meta = await sharp(data).metadata()
  assert.equal(meta.format, 'webp')
  assert.equal(meta.exif, undefined)
  assert.equal(meta.orientation, undefined)
})

test('a rendition is turned upright and fitted inside its edge', async () => {
  const { width, height } = await encodeRendition(await photoWithExif(), 'thumb')
  // Orientation 6 turns the 3000×1000 frame a quarter: portrait, long edge 480.
  assert.deepEqual([width, height], [160, 480])
  const preview = await encodeRendition(await photoWithExif(), 'preview')
  assert.equal(Math.max(preview.width, preview.height), 2048)
})

test('a small image is never enlarged', async () => {
  const tiny = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#000' } }).png().toBuffer()
  const { width, height } = await encodeRendition(tiny, 'preview')
  assert.deepEqual([width, height], [40, 30])
})
