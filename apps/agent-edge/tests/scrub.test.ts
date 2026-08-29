// A browser writes what you type into its window title, and the demonstration
// recorder reads titles. This is the seam where a password typed during a
// takeover could end up in a skill, so it gets its own test.
// Run: pnpm --filter @visvine/agent-edge test
import test from 'node:test'
import assert from 'node:assert/strict'
import { scrub } from '../src/redact'

const SECRET = 'hunter2-the-actual-password'

test('a typed secret is removed from a window title', () => {
  const title = `example.com${SECRET} - Google Chrome for Testing`
  const out = scrub(title, [SECRET])
  assert.ok(!out.includes(SECRET))
  assert.equal(out, 'example.com[redacted] - Google Chrome for Testing')
})

test('a title captured mid-word loses the part that was typed so far', () => {
  // The recorder samples the title while typing is still happening, so the
  // whole secret is often not there yet — only a prefix of it.
  const out = scrub(`search: hunter2-the-act - Chrome`, [SECRET])
  assert.ok(!out.includes('hunter2'))
  assert.match(out, /\[redacted\]/)
})

test('several secrets in one demonstration are all removed', () => {
  const out = scrub('user@example.com / correct-horse-battery', ['user@example.com', 'correct-horse-battery'])
  assert.ok(!out.includes('user@example.com'))
  assert.ok(!out.includes('correct-horse-battery'))
})

test('an ordinary title is left alone', () => {
  assert.equal(scrub('Example Domain - Chrome', [SECRET]), 'Example Domain - Chrome')
  assert.equal(scrub('Example Domain - Chrome', []), 'Example Domain - Chrome')
})

test('a very short keystroke does not redact half the page name', () => {
  // Typing "a" must not turn every title into holes; a secret that short is
  // not one, and the recorder does not remember it in the first place.
  assert.equal(scrub('Amazon - Chrome', ['a']), 'Amazon - Chrome')
  assert.equal(scrub('Amazon - Chrome', ['Ama']), 'Amazon - Chrome')
})
