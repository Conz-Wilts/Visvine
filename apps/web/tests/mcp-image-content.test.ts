/**
 * A screenshot an action returns reaches an MCP client as an image block its
 * model can look at, not as base64 inside the JSON (lib/mcp/auth.ts#toContent).
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/mcp-image-content.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { toContent } from '@/lib/mcp/auth'

test('a nested screenshot becomes an image block and the JSON points at it', () => {
  const content = toContent({ name: 'board', screenshot: { available: true, png_base64: 'iVBOR', jpeg_base64: null, mime: 'image/png' } })
  assert.equal(content.length, 2)
  assert.deepEqual(content[1], { type: 'image', data: 'iVBOR', mimeType: 'image/png' })
  const json = JSON.parse((content[0] as { text: string }).text)
  assert.equal(json.screenshot.png_base64, '[image 1, attached]')
  assert.equal(json.screenshot.jpeg_base64, null)
})

test('an answer with no image is one text block, and a string stays a string', () => {
  assert.deepEqual(toContent({ ok: true }), [{ type: 'text', text: '{\n  "ok": true\n}' }])
  assert.deepEqual(toContent('done'), [{ type: 'text', text: 'done' }])
})
