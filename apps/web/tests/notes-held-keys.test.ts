// The parts of a note's raw text that are not the writer's — where they sit,
// and which edits touch them (lib/notes/shared/heldKeys.ts).
import test from 'node:test'
import assert from 'node:assert/strict'
import { editTouchesHeld, heldSpans, heldText } from '@/lib/notes/shared/heldKeys'
import { heldFrontmatterKeys } from '@/lib/notes/shared/indexNote'

const PERSON = [
  '---',
  'type: Person',
  'title: Connor',
  'node: person:connor',
  'description: runs the fund',
  'tags:',
  '  - founder',
  '  - nz',
  'start_at: 2026-01-01',
  '---',
  '',
  'Prose about Connor.',
  '',
  '<!-- index:children -->',
  '## Notes',
  '',
  '* [Calls](calls.md) - the call log',
  '<!-- /index:children -->',
  '',
].join('\n')

const startOfLine = (n: number) => PERSON.split('\n').slice(0, n).reduce((at, l) => at + l.length + 1, 0)

test('held spans cover the fences, each held entry with its continuation lines, and the child block', () => {
  const spans = heldSpans(PERSON, ['type', 'node', 'title', 'tags', 'start_at'])
  const keys = spans.map((s) => s.key)
  assert.deepEqual(keys, ['---', 'type', 'title', 'node', 'tags', 'start_at', '---', 'children'])
  const text = (key: string) => {
    const s = spans.find((x) => x.key === key)!
    return PERSON.slice(s.start, s.end)
  }
  assert.equal(text('type'), 'type: Person\n')
  // A YAML list is one entry: the key line and every indented line after it.
  assert.equal(text('tags'), 'tags:\n  - founder\n  - nz\n')
  assert.equal(text('start_at'), 'start_at: 2026-01-01\n')
  // The block is held with the blank line before it, marker to marker.
  assert.equal(text('children'), '\n\n<!-- index:children -->\n## Notes\n\n* [Calls](calls.md) - the call log\n<!-- /index:children -->\n')
  // description is free, so nothing covers it.
  const desc = startOfLine(4)
  assert.ok(!spans.some((s) => s.start <= desc && desc < s.end))
})

test('a plain note holds only its child block, whatever the keys say', () => {
  // The block is regenerated on every index write, entity or not.
  assert.deepEqual(heldSpans(PERSON, []).map((s) => s.key), ['children'])
  assert.deepEqual(heldSpans('---\ntitle: x\n---\n\nbody\n', []), [])
  const bare = 'Just prose.\n\n<!-- index:children -->\n<!-- /index:children -->\n'
  assert.deepEqual(
    heldSpans(bare, ['type']).map((s) => s.key),
    ['children'],
  )
  assert.deepEqual(heldSpans('---\ntitle: x\n---\n\nbody\n', ['node']).map((s) => s.key), ['---', '---'])
})

test('an edit touches a held span when it lands inside one, not when it starts right after', () => {
  const spans = heldSpans(PERSON, ['type', 'node'])
  const typeAt = startOfLine(1)
  const titleAt = startOfLine(2)
  // Typing at the start of, or inside, `type:` is refused.
  assert.equal(editTouchesHeld(spans, typeAt, typeAt), true)
  assert.equal(editTouchesHeld(spans, typeAt + 3, typeAt + 3), true)
  // Typing at the start of the free `title:` line — the character after the
  // held newline — is fine.
  assert.equal(editTouchesHeld(spans, titleAt, titleAt), false)
  // Backspace at that same spot would eat the held newline: refused.
  assert.equal(editTouchesHeld(spans, titleAt - 1, titleAt), true)
  // A selection reaching into a held line is refused; one inside free text is not.
  assert.equal(editTouchesHeld(spans, titleAt + 2, startOfLine(3) + 4), true)
  assert.equal(editTouchesHeld(spans, titleAt, titleAt + 5), false)
})

test('heldText is stable across free edits and changes on a held one', () => {
  const keys = ['type', 'node']
  const free = PERSON.replace('runs the fund', 'runs the fund now').replace('Prose about', 'More prose about')
  assert.equal(heldText(free, keys), heldText(PERSON, keys))
  assert.notEqual(heldText(PERSON.replace('type: Person', 'type: Event'), keys), heldText(PERSON, keys))
  assert.notEqual(heldText(PERSON.replace('node: person:connor\n', ''), keys), heldText(PERSON, keys))
})

test('the keys an entity index holds: type and node, plus what the record owns; an adopted note keeps its type', () => {
  const entity = { typeLabel: 'Person', nodeId: 'person:connor', name: 'Connor', held: { title: 'Connor', start_at: null } }
  assert.deepEqual(heldFrontmatterKeys(entity), ['type', 'node', 'title', 'start_at'])
  assert.deepEqual(heldFrontmatterKeys(entity, true), ['node', 'title', 'start_at'])
  assert.deepEqual(heldFrontmatterKeys({ typeLabel: 'tool', nodeId: 'tool:x', name: 'x' }), ['type', 'node'])
})
