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
