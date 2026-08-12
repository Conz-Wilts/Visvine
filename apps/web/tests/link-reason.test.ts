// Link-reason plumbing: the pure excerpt extractor feeding the context-link
// sync, and the metadata.context coercers shared by server and client.
// test runner: node --import tsx --test tests/link-reason.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { excerptsForTargets } from '../lib/notes/shared/references'
import {
  readLinkContextMeta,
  combinedExcerptHash,
  firstExcerpt,
  nextContextMeta,
  mergeContextMeta,
  type LinkContextMeta,
} from '../lib/notes/context/linkReason'

test('excerptsForTargets maps each linked target to its containing block', () => {
  const body = [
    'Intro paragraph with no links.',
    '',
    'Met [Craig](/people/craig.md) at the summit and we discussed connectors.',
    '',
    '- [Halter](/communities/halter.md) is hiring engineers',
    '- another bullet',
  ].join('\n')
  const out = excerptsForTargets('people/ana.md', body)
  assert.equal(
    out.get('people/craig.md'),
    'Met Craig at the summit and we discussed connectors.',
  )
  // A list item keeps only its own line, and link syntax is stripped.
  assert.equal(out.get('communities/halter.md'), 'Halter is hiring engineers')
})

test('excerptsForTargets keeps the first mention, resolves relative hrefs, caps length', () => {
  const body =
    'First [Craig](craig.md) mention.\n\nSecond [Craig](/people/craig.md) mention.\n\n' +
    `Long: [Ana](/people/ana.md) ${'x'.repeat(600)}`
  const out = excerptsForTargets('people/bob.md', body)
  // craig.md relative to people/bob.md resolves to people/craig.md — first wins.
  assert.equal(out.get('people/craig.md'), 'First Craig mention.')
  assert.ok((out.get('people/ana.md') ?? '').length <= 500)
})

test('readLinkContextMeta coerces valid payloads and rejects malformed ones', () => {
  assert.equal(readLinkContextMeta(null), null)
  assert.equal(readLinkContextMeta({}), null)
  assert.equal(readLinkContextMeta({ context: 'nope' }), null)

  const meta = readLinkContextMeta({
    other: true,
    context: {
      excerpts: {
        'people/a.md': { text: 'works with B', hash: 'h1' },
        'people/bad.md': { text: 42 },
      },
      reason: 'collaborators',
      reasonHash: 'people/a.md:h1',
      reasonModel: 'gemma',
    },
  })
  assert.ok(meta)
  assert.deepEqual(Object.keys(meta.excerpts), ['people/a.md'])
  assert.equal(meta.reason, 'collaborators')
  assert.equal(meta.reasonModel, 'gemma')
  // Empty reason string is normalized to absent.
  const empty = readLinkContextMeta({ context: { excerpts: {}, reason: '' } })
  assert.equal(empty?.reason, undefined)
})

test('combinedExcerptHash is key-order independent and change-sensitive', () => {
  const a: LinkContextMeta = {
    excerpts: {
      'people/b.md': { text: 't2', hash: 'h2' },
      'people/a.md': { text: 't1', hash: 'h1' },
    },
  }
  const b: LinkContextMeta = {
    excerpts: {
      'people/a.md': { text: 't1', hash: 'h1' },
      'people/b.md': { text: 't2', hash: 'h2' },
    },
  }
  assert.equal(combinedExcerptHash(a), combinedExcerptHash(b))
  const changed: LinkContextMeta = {
    excerpts: { ...a.excerpts, 'people/a.md': { text: 't1x', hash: 'h1x' } },
  }
  assert.notEqual(combinedExcerptHash(a), combinedExcerptHash(changed))
})

const keepAll = () => true

test('nextContextMeta writes only its own key and keeps the counterpart', () => {
  const prior: LinkContextMeta = {
    excerpts: { 'people/b.md': { text: 'B on A', hash: 'hb' } },
    reason: 'old reason',
    reasonHash: 'stale',
  }
  const next = nextContextMeta(prior, 'people/a.md', { text: 'A on B', hash: 'ha' }, keepAll)
  assert.ok(next)
  assert.equal(next.excerpts['people/b.md'].text, 'B on A')
  assert.equal(next.excerpts['people/a.md'].text, 'A on B')
  // Reason fields ride along untouched; the hash mismatch is what re-queues AI.
  assert.equal(next.reason, 'old reason')
  assert.ok(next.updatedAt)
})

test('nextContextMeta returns null when the excerpt set is unchanged', () => {
  const prior: LinkContextMeta = {
    excerpts: { 'people/a.md': { text: 'same', hash: 'h1' } },
  }
  assert.equal(nextContextMeta(prior, 'people/a.md', { text: 'same', hash: 'h1' }, keepAll), null)
  // Changed hash → change.
  assert.ok(nextContextMeta(prior, 'people/a.md', { text: 'new', hash: 'h2' }, keepAll))
  // Dropped excerpt → change.
  assert.ok(nextContextMeta(prior, 'people/a.md', null, keepAll))
  // From-nothing no-op stays null.
  assert.equal(nextContextMeta(null, 'people/a.md', null, keepAll), null)
})

test('nextContextMeta prunes keys whose note no longer resolves', () => {
  const prior: LinkContextMeta = {
    excerpts: {
      'people/dead.md': { text: 'gone', hash: 'hd' },
      'people/b.md': { text: 'kept', hash: 'hb' },
    },
  }
  const next = nextContextMeta(prior, 'people/a.md', { text: 'A', hash: 'ha' }, (k) => k !== 'people/dead.md')
  assert.ok(next)
  assert.deepEqual(Object.keys(next.excerpts).sort(), ['people/a.md', 'people/b.md'])
})

test('mergeContextMeta preserves foreign metadata keys', () => {
  const merged = mergeContextMeta(
    { imported: true, context: { excerpts: {} } },
    { excerpts: { 'people/a.md': { text: 't', hash: 'h' } } },
  )
  assert.equal(merged.imported, true)
  assert.deepEqual(
    (merged.context as LinkContextMeta).excerpts['people/a.md'],
    { text: 't', hash: 'h' },
  )
})

test('firstExcerpt prefers the asked-for path, falls back in key order', () => {
  const meta: LinkContextMeta = {
    excerpts: {
      'people/b.md': { text: 'from b', hash: 'hb' },
      'people/a.md': { text: 'from a', hash: 'ha' },
    },
  }
  assert.equal(firstExcerpt(meta, 'people/b.md'), 'from b')
  assert.equal(firstExcerpt(meta), 'from a')
  assert.equal(firstExcerpt(null), null)
})
