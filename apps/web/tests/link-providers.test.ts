// Which links we recognise, the one address shares of a link agree on, and the
// embed URLs we build ourselves.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canonicalUrl, FRAME_HOSTS, linkProviderOf, PROVIDER_LABEL, providerOf } from '../lib/links/shared/providers'

test('every view of one Google file is one resource', () => {
  const ids = [
    'https://docs.google.com/spreadsheets/d/1AbCdEfGhIj/edit#gid=0',
    'https://docs.google.com/spreadsheets/d/1AbCdEfGhIj/view?usp=sharing',
    'http://docs.google.com/spreadsheets/u/0/d/1AbCdEfGhIj/',
  ].map(canonicalUrl)
  assert.deepEqual(new Set(ids), new Set(['https://docs.google.com/spreadsheets/d/1AbCdEfGhIj']))
  assert.equal(linkProviderOf(ids[0]!), 'google-sheet')
  assert.equal(providerOf(ids[0]!)?.embedUrl, 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIj/preview')
  assert.equal(
    canonicalUrl('https://drive.google.com/open?id=1AbCdEfGhIj'),
    'https://drive.google.com/file/d/1AbCdEfGhIj',
  )
})

test('video links fold to one watch URL and embed without cookies', () => {
  for (const url of [
    'https://youtu.be/dQw4w9WgXcQ?si=track',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=10',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
  ]) {
    assert.equal(canonicalUrl(url), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  }
  const yt = providerOf('https://youtu.be/dQw4w9WgXcQ')!
  assert.equal(yt.embedUrl, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
  assert.equal(yt.player, true)
  assert.equal(providerOf('https://www.loom.com/share/abc123def')?.embedUrl, 'https://www.loom.com/embed/abc123def')
  assert.equal(providerOf('https://vimeo.com/76979871')?.embedUrl, 'https://player.vimeo.com/video/76979871')
})

test('a Figma file embeds on its own host with ours named', () => {
  const figma = providerOf('https://www.figma.com/design/AbC123xyz/Launch?node-id=1-2&t=x')!
  assert.equal(figma.canonical, 'https://www.figma.com/design/AbC123xyz')
  assert.equal(figma.embedUrl, 'https://embed.figma.com/design/AbC123xyz?embed-host=visvine&node-id=1-2')
})

test('the open web is normalised, tracking dropped, never framed', () => {
  assert.equal(
    canonicalUrl('http://WWW.Example.com/post/?utm_source=x&b=2&a=1&fbclid=z#top'),
    'https://example.com/post/?a=1&b=2',
  )
  assert.equal(canonicalUrl('https://example.com/'), 'https://example.com')
  assert.equal(canonicalUrl('https://example.com/a/'), 'https://example.com/a')
  assert.equal(providerOf('https://example.com/a'), null)
  assert.equal(linkProviderOf('https://example.com'), 'web')
  assert.equal(canonicalUrl('javascript:alert(1)'), null)
})

test('every embed we build is served from a framed host', () => {
  for (const url of [
    'https://docs.google.com/document/d/1AbCdEfGhIj/edit',
    'https://drive.google.com/file/d/1AbCdEfGhIj/view',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://www.figma.com/file/AbC123xyz/x',
    'https://www.loom.com/share/abc123def',
    'https://vimeo.com/76979871',
  ]) {
    const embed = providerOf(url)!.embedUrl!
    assert.ok(FRAME_HOSTS.some((host) => embed.startsWith(`${host}/`)), embed)
  }
})

test('the open action names where a link opens', () => {
  assert.equal(PROVIDER_LABEL[linkProviderOf('https://docs.google.com/spreadsheets/d/1AbCdEfGhIj/edit')], 'Google Sheets')
  assert.equal(PROVIDER_LABEL[linkProviderOf('https://example.com')], 'browser')
})
