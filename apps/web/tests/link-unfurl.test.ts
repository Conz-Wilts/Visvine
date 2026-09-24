// Reading a link into a preview: precedence, parsing and media URLs.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decodeEntities,
  extractUrls,
  headOf,
  mediaTypeOfContentType,
  mediaUnfurl,
  normaliseUrl,
  oembedHrefOf,
  parseHead,
} from '../lib/links/shared/unfurl'

const BASE = 'https://example.com/articles/one'

test('meta tags are read in any attribute order, entities decoded', () => {
  const html = `<head>
    <meta content="Fish &amp; Chips" property="og:title">
    <meta property='og:description' content='It&#39;s &quot;good&quot;'>
  </head>`
  const u = parseHead(html, BASE)!
  assert.equal(u.title, 'Fish & Chips')
  assert.equal(u.description, `It's "good"`)
})

test('og wins over twitter, twitter over the plain title', () => {
  const html = `<head><title>Plain</title>
    <meta name="twitter:title" content="Tweet title">
    <meta property="og:title" content="OG title">
    <meta name="description" content="plain description">
    <meta name="twitter:image" content="/tw.png">
  </head>`
  const u = parseHead(html, BASE)!
  assert.equal(u.title, 'OG title')
  assert.equal(u.description, 'plain description')
  assert.equal(u.imageUrl, 'https://example.com/tw.png')
})

test('the plain title stands in when nothing else names the page', () => {
  const u = parseHead('<head><title> Just a page </title><meta name="description" content="d"></head>', BASE)!
  assert.equal(u.title, 'Just a page')
})

test('an oEmbed answer is laid over the page, and never its html', () => {
  const html = `<head><meta property="og:title" content="Page"><meta property="og:image" content="https://x.test/og.png"></head>`
  const u = parseHead(html, BASE, {
    title: 'Video title',
    author_name: 'Ana',
    provider_name: 'YouTube',
    thumbnail_url: 'https://i.ytimg.com/t.jpg',
    type: 'video',
  })!
  assert.equal(u.title, 'Video title')
  assert.equal(u.siteName, 'YouTube')
  assert.equal(u.authorName, 'Ana')
  assert.equal(u.imageUrl, 'https://i.ytimg.com/t.jpg')
  assert.equal(u.mediaType, 'video')
  assert.equal('html' in u, false)
})

test('image, icon and oEmbed hrefs resolve against the page', () => {
  const html = `<head>
    <link rel="icon" href="/favicon.png">
    <link rel="alternate" type="application/json+oembed" href="/oembed?url=x">
    <meta property="og:image" content="../img/a.png">
    <meta property="og:title" content="T">
  </head>`
  const u = parseHead(html, BASE)!
  assert.equal(u.faviconUrl, 'https://example.com/favicon.png')
  assert.equal(u.imageUrl, 'https://example.com/img/a.png')
  assert.equal(oembedHrefOf(html, BASE), 'https://example.com/oembed?url=x')
})

test('a page with no icon falls back to /favicon.ico', () => {
  assert.equal(parseHead('<head><title>T</title></head>', BASE)!.faviconUrl, 'https://example.com/favicon.ico')
})

test('twitter:card summary is a small thumb; anything else with an image is large', () => {
  const summary = parseHead('<head><meta name="twitter:card" content="summary"><meta property="og:image" content="/a.png"></head>', BASE)!
  assert.equal(summary.imageLayout, 'summary')
  const large = parseHead('<head><meta property="og:image" content="/a.png"></head>', BASE)!
  assert.equal(large.imageLayout, 'large')
})

test('a javascript: image is refused', () => {
  const u = parseHead('<head><meta property="og:title" content="T"><meta property="og:image" content="javascript:alert(1)"></head>', BASE)!
  assert.equal(u.imageUrl, null)
})

test('a page that says nothing previewable is null', () => {
  assert.equal(parseHead('<head></head><body>hi</body>', BASE), null)
})

test('only the head is read', () => {
  assert.equal(headOf('<head><title>a</title></head><body><meta property="og:title" content="late">'), '<head><title>a</title>')
  const u = parseHead('<head><title>a</title></head><body><meta property="og:title" content="late"></body>', BASE)!
  assert.equal(u.title, 'a')
})

test('a content type decides a media URL', () => {
  assert.equal(mediaTypeOfContentType('text/html; charset=utf-8'), null)
  assert.equal(mediaTypeOfContentType('image/png'), 'image')
  assert.equal(mediaTypeOfContentType('video/mp4'), 'video')
  assert.equal(mediaTypeOfContentType('audio/mpeg'), 'audio')
  assert.equal(mediaTypeOfContentType('application/pdf'), 'file')
  const img = mediaUnfurl('https://x.test/photos/cat%20one.jpg', 'image')
  assert.equal(img.title, 'cat one.jpg')
  assert.equal(img.imageUrl, 'https://x.test/photos/cat%20one.jpg')
})

test('URLs are pulled from text with trailing punctuation trimmed', () => {
  assert.deepEqual(
    extractUrls('see https://a.test/x, and (https://b.test/y). https://a.test/x'),
    ['https://a.test/x', 'https://b.test/y'],
  )
})

test('two shares of one link normalise to one key', () => {
  assert.equal(
    normaliseUrl('http://WWW.Example.com/a/?utm_source=x#top'),
    normaliseUrl('https://example.com/a'),
  )
  assert.notEqual(normaliseUrl('https://example.com/a?id=1'), normaliseUrl('https://example.com/a?id=2'))
})

test('numeric and unknown entities', () => {
  assert.equal(decodeEntities('&#x41;&#66;&bogus;'), 'AB&bogus;')
})

test('JSON-LD names the thing: its headline, author and date win over Open Graph', () => {
  const html = `<head>
    <meta property="og:title" content="Site title | Paper">
    <meta property="og:image" content="/og.jpg">
    <script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[
        {"@type":"Organization","name":"Paper","logo":"/logo.png"},
        {"@type":"NewsArticle","headline":"Rates held at 5.5%","author":[{"@type":"Person","name":"Ana Ruiz"}],
         "datePublished":"2026-09-20T08:00:00+12:00","image":{"url":"/ld.jpg"}}
      ]}
    </script>
  </head>`
  const unfurl = parseHead(html, BASE)!
  assert.equal(unfurl.title, 'Rates held at 5.5%')
  assert.equal(unfurl.authorName, 'Ana Ruiz')
  assert.equal(unfurl.publishedAt, '2026-09-19T20:00:00.000Z')
  assert.equal(unfurl.imageUrl, 'https://example.com/og.jpg', 'the page image prefers Open Graph over JSON-LD')
})

test('malformed or irrelevant JSON-LD is ignored, never trusted', () => {
  const html = `<head>
    <title>Plain</title>
    <script type="application/ld+json">{not json</script>
    <script type="application/ld+json">{"@type":"BreadcrumbList","name":"Home"}</script>
    <meta property="article:published_time" content="not a date">
  </head>`
  const unfurl = parseHead(html, BASE)!
  assert.equal(unfurl.title, 'Plain')
  assert.equal(unfurl.publishedAt, null)
})

test('a VideoObject is a video, and its image stands in when nothing else offers one', () => {
  const html = `<head><script type="application/ld+json">
    {"@type":"VideoObject","name":"Launch walkthrough","thumbnailUrl":["https://cdn.example.com/t.jpg"],"uploadDate":"2026-09-01"}
  </script></head>`
  const unfurl = parseHead(html, BASE)!
  assert.equal(unfurl.mediaType, 'video')
  assert.equal(unfurl.imageUrl, 'https://cdn.example.com/t.jpg')
  assert.equal(unfurl.publishedAt, '2026-09-01T00:00:00.000Z')
})

test('the PNG inside an .ico is found; an .ico of bitmaps has none', async () => {
  const { largestPngInIco } = await import('../lib/resources/shared/ico')
  const png = (w: number) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(w)])
  const small = png(10)
  const big = png(40)
  const header = Buffer.alloc(6 + 32)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(2, 4)
  const entries: Array<[number, Buffer]> = [[16, small], [64, big]]
  let offset = header.length
  entries.forEach(([width, data], i) => {
    const at = 6 + i * 16
    header[at] = width
    header.writeUInt32LE(data.length, at + 8)
    header.writeUInt32LE(offset, at + 12)
    offset += data.length
  })
  const ico = Buffer.concat([header, small, big])
  assert.ok(largestPngInIco(ico)?.equals(big))
  const bitmap = Buffer.from(ico)
  bitmap.fill(0, header.length + 1)
  assert.equal(largestPngInIco(bitmap), null)
  assert.equal(largestPngInIco(Buffer.from('not an icon')), null)
})
