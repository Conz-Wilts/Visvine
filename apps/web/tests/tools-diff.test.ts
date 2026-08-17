/**
 * The line diff behind the Tool review screens (features/tools/lib/diff.ts).
 *
 * The thing under test is not really "does it diff" — it is "can a super-admin
 * trust what this shows them", so the cases here are the ways a diff can lie:
 * a change reported at the wrong line, an edit hidden outside its hunk, two
 * nearby edits printed as overlapping hunks, or a whole-file replacement
 * quietly presented as if it had been compared line by line.
 *
 * Run: pnpm --filter @visvine/web exec node --import tsx --test tests/tools-diff.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { DIFF_CONTEXT_LINES, diffLines, type DiffLine } from '@/features/tools/lib/diff'

/** Flatten every hunk's lines, in order. */
function allLines(before: string, after: string, context?: number): DiffLine[] {
  return diffLines(before, after, context === undefined ? undefined : { context }).hunks.flatMap(
    (hunk) => hunk.lines,
  )
}

/** The rendered shape of a diff, as a reviewer reads it. */
function render(before: string, after: string, context?: number): string[] {
  return allLines(before, after, context).map(
    (line) => `${line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' '}${line.text}`,
  )
}

const LINES = (...values: string[]) => values.join('\n')

test('identical text produces no hunks', () => {
  const diff = diffLines('a\nb\nc\n', 'a\nb\nc\n')
  assert.deepEqual(diff.hunks, [])
  assert.equal(diff.unchanged, true)
  assert.equal(diff.added, 0)
  assert.equal(diff.removed, 0)
  assert.equal(diff.truncated, false)
})

test('a trailing newline is not a change', () => {
  // "a\nb" and "a\nb\n" are the same two lines; a diff that says otherwise
  // makes every save look like an edit.
  assert.equal(diffLines('a\nb', 'a\nb\n').unchanged, true)
  assert.equal(diffLines('a\nb\n', 'a\nb').unchanged, true)
})

test('CRLF and LF sources with the same text do not differ', () => {
  assert.equal(diffLines('a\r\nb\r\nc\r\n', 'a\nb\nc\n').unchanged, true)
})

test('an empty file gaining content is all additions', () => {
  const diff = diffLines('', 'one\ntwo\n')
  assert.equal(diff.added, 2)
  assert.equal(diff.removed, 0)
  assert.equal(diff.hunks.length, 1)
  assert.equal(diff.hunks[0].beforeStart, 0, 'nothing to start from on the before side')
  assert.equal(diff.hunks[0].afterStart, 1)
  assert.deepEqual(render('', 'one\ntwo\n'), ['+one', '+two'])
})

test('a file emptied is all removals', () => {
  const diff = diffLines('one\ntwo\n', '')
  assert.equal(diff.removed, 2)
  assert.equal(diff.added, 0)
  assert.equal(diff.hunks[0].afterStart, 0)
})

test('a one-line edit reports the replaced line, removal first', () => {
  const before = LINES('one', 'two', 'three')
  const after = LINES('one', 'TWO', 'three')
  assert.deepEqual(render(before, after), [' one', '-two', '+TWO', ' three'])

  const diff = diffLines(before, after)
  assert.equal(diff.added, 1)
  assert.equal(diff.removed, 1)
  assert.equal(diff.hunks.length, 1)
})

test('line numbers are 1-based and side-correct', () => {
  const before = LINES('a', 'b', 'c', 'd')
  const after = LINES('a', 'c', 'd', 'e')
  const lines = allLines(before, after)

  const removed = lines.find((line) => line.kind === 'remove')
  assert.equal(removed?.text, 'b')
  assert.equal(removed?.before, 2, 'b was the second line of the old file')
  assert.equal(removed?.after, null, 'a removed line has no new-file number')

  const added = lines.find((line) => line.kind === 'add')
  assert.equal(added?.text, 'e')
  assert.equal(added?.after, 4)
  assert.equal(added?.before, null)

  const context = lines.filter((line) => line.kind === 'context')
  assert.deepEqual(
    context.map((line) => [line.text, line.before, line.after]),
    [
      ['a', 1, 1],
      ['c', 3, 2],
      ['d', 4, 3],
    ],
    'context lines carry both numbers, and they diverge after the removal',
  )
})

test('a change deep inside a long file is framed by context, not the whole file', () => {
  const before = LINES(...Array.from({ length: 40 }, (_, i) => `line ${i + 1}`))
  const after = before.replace('line 20', 'line 20 changed')
  const diff = diffLines(before, after)

  assert.equal(diff.hunks.length, 1)
  const hunk = diff.hunks[0]
  // 3 context + (-1 +1) + 3 context
  assert.equal(hunk.lines.length, 2 * DIFF_CONTEXT_LINES + 2)
  assert.equal(hunk.beforeStart, 17)
  assert.equal(hunk.beforeCount, DIFF_CONTEXT_LINES * 2 + 1)
  assert.equal(hunk.afterStart, 17)
  assert.equal(
    diff.hunks.flatMap((h) => h.lines).filter((line) => line.kind === 'context').length,
    DIFF_CONTEXT_LINES * 2,
  )
})

test('two nearby edits merge into one hunk; distant ones do not', () => {
  const base = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`)

  const near = [...base]
  near[10] = 'edited 11'
  near[14] = 'edited 15'
  const nearDiff = diffLines(LINES(...base), LINES(...near))
  assert.equal(nearDiff.hunks.length, 1, 'four lines apart is inside 2× context — one hunk')
  // No line may be printed twice, which is what an unmerged overlap would do.
  const printed = nearDiff.hunks[0].lines.filter((line) => line.before !== null).map((line) => line.before)
  assert.equal(new Set(printed).size, printed.length)

  const far = [...base]
  far[5] = 'edited 6'
  far[30] = 'edited 31'
  assert.equal(diffLines(LINES(...base), LINES(...far)).hunks.length, 2)
})

test('context: 0 shows only the changed lines', () => {
  const before = LINES('a', 'b', 'c', 'd', 'e')
  const after = LINES('a', 'b', 'C', 'd', 'e')
  assert.deepEqual(render(before, after, 0), ['-c', '+C'])
})

test('a move is reported as a removal and an addition, not a silent reorder', () => {
  const before = LINES('alpha', 'beta', 'gamma')
  const after = LINES('beta', 'gamma', 'alpha')
  const diff = diffLines(before, after)
  assert.equal(diff.added, 1)
  assert.equal(diff.removed, 1)
  assert.deepEqual(render(before, after), ['-alpha', ' beta', ' gamma', '+alpha'])
})

test('the common head and tail are trimmed before the table is built', () => {
  // 3000 identical lines either side of one edit would be a 6001×6001 table if
  // the trim did not happen first — this test is the trim.
  const head = Array.from({ length: 3000 }, (_, i) => `head ${i}`)
  const tail = Array.from({ length: 3000 }, (_, i) => `tail ${i}`)
  const before = LINES(...head, 'middle', ...tail)
  const after = LINES(...head, 'MIDDLE', ...tail)

  const diff = diffLines(before, after)
  assert.equal(diff.truncated, false, 'trimmed down to one line each side')
  assert.equal(diff.hunks.length, 1)
  assert.equal(diff.added, 1)
  assert.equal(diff.removed, 1)
  assert.equal(diff.hunks[0].beforeStart, 2998)
})

test('a comparison past the cell ceiling degrades to a replacement, and says so', () => {
  // 2100 × 2100 = 4.41M cells, past MAX_CELLS, with nothing common to trim.
  const before = LINES(...Array.from({ length: 2100 }, (_, i) => `old ${i}`))
  const after = LINES(...Array.from({ length: 2100 }, (_, i) => `new ${i}`))

  const diff = diffLines(before, after)
  assert.equal(diff.truncated, true, 'the UI must be able to say the diff is approximate')
  assert.equal(diff.removed, 2100)
  assert.equal(diff.added, 2100)
  assert.equal(diff.hunks.length, 1)
  const kinds = new Set(diff.hunks[0].lines.map((line) => line.kind))
  assert.deepEqual([...kinds].sort(), ['add', 'remove'])
})

test('a realistic ui.tsx edit reads the way a reviewer expects', () => {
  const before = LINES(
    "import { Card } from '@visvine/tool-kit'",
    '',
    'export default function Tool() {',
    '  return <Card>hello</Card>',
    '}',
  )
  const after = LINES(
    "import { Card, Button } from '@visvine/tool-kit'",
    '',
    'export default function Tool() {',
    '  const [open, setOpen] = useState(false)',
    '  return <Card>hello</Card>',
    '}',
  )
  assert.deepEqual(render(before, after), [
    "-import { Card } from '@visvine/tool-kit'",
    "+import { Card, Button } from '@visvine/tool-kit'",
    ' ',
    ' export default function Tool() {',
    '+  const [open, setOpen] = useState(false)',
    '   return <Card>hello</Card>',
    ' }',
  ])
})
