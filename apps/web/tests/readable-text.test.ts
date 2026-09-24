/**
 * readableText (lib/links/shared/readable.ts): a fetched page as a model
 * should read it — links kept absolute, markup and highlight copies gone.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/readable-text.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readableText } from '@/lib/links/shared/readable'

const PAGE = `<!doctype html><html><head><title>Hacker News &amp; friends</title><style>.x{color:red}</style>
<script>window.track = 1</script></head><body><nav><a href="/login">login</a></nav>
<h1>Front page</h1><table><tr><td class="title"><a href="https://example.com/ai">An AI story</a></td><td>557 points</td></tr>
<tr><td><a href="item?id=42">discussion</a></td></tr></table>
<ul><li>First &mdash; one</li><li>Second</li></ul><p>A&nbsp;paragraph<br>on two lines.</p>
<a href="javascript:void(0)">nothing</a><footer>© 2026</footer></body></html>`

test('HTML keeps the title, headings, lists and absolute links, and drops the rest', () => {
  const out = readableText(PAGE, 'text/html; charset=utf-8', 'https://news.ycombinator.com/')
  assert.match(out, /^# Hacker News & friends/)
  assert.match(out, /# Front page/)
  assert.match(out, /\[An AI story\]\(https:\/\/example\.com\/ai\) \| 557 points/)
  assert.match(out, /\[discussion\]\(https:\/\/news\.ycombinator\.com\/item\?id=42\)/)
  assert.match(out, /- First — one/)
  assert.match(out, /A paragraph\non two lines\./)
  for (const gone of ['window.track', 'color:red', 'login', '© 2026', 'javascript:']) assert.ok(!out.includes(gone), gone)
  assert.ok(out.length < PAGE.length / 2)
})

test('JSON drops highlight copies and puts one record per line', () => {
  const body = JSON.stringify({
    hits: [
      { title: 'A', url: 'https://a', points: 10, objectID: '1', _highlightResult: { title: { value: '<em>A</em>' } } },
      { title: 'B', url: null, points: 5, objectID: '2', _highlightResult: { title: { value: 'B' } } },
    ],
    nbHits: 2,
    page: 0,
  })
  const out = readableText(body, 'application/json; charset=utf-8')
  assert.equal(out.split('\n').length, 4)
  assert.equal(out.split('\n')[0], '{"nbHits":2,"page":0}')
  assert.equal(out.split('\n')[1], 'hits (2):')
  assert.equal(out.split('\n')[2], '{"title":"A","url":"https://a","points":10,"objectID":"1"}')
  assert.ok(!out.includes('_highlightResult'))
})

test('anything else, and JSON that does not parse, comes back as it was', () => {
  assert.equal(readableText('plain words', 'text/plain'), 'plain words')
  assert.equal(readableText('{not json', 'application/json'), '{not json')
})
