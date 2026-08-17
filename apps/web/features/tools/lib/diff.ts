/**
 * A small line diff — the thing a super-admin actually reads when asked to
 * approve a Tool version, and an admin reads when asked to accept an upgrade.
 * "Here is the new code" is not a review; "here is what changed" is.
 *
 * Deliberately hand-rolled and pure:
 *   • no dependency, because it renders inside the review screen and the whole
 *     point of that screen is that nothing about it is surprising;
 *   • no DOM, so it is a unit test rather than a screenshot;
 *   • unified-diff shaped (hunks with context) because that is the form every
 *     reviewer already knows how to read.
 *
 * The algorithm is a classic LCS: trim the common head and tail first (real
 * edits touch a handful of lines in the middle of a file, so this usually leaves
 * almost nothing to compare), then a DP table over what is left. Past
 * `MAX_CELLS` the table stops being worth its memory and the middle is reported
 * as a wholesale replacement with `truncated` set, rather than the UI silently
 * hanging on a pathological pair of files.
 */

type DiffLineKind = 'context' | 'add' | 'remove'

export interface DiffLine {
  kind: DiffLineKind
  text: string
  /** 1-based line number in `before`; null on an added line. */
  before: number | null
  /** 1-based line number in `after`; null on a removed line. */
  after: number | null
}

/** A run of changed lines plus its surrounding context, as `@@` would frame it. */
interface DiffHunk {
  /** 1-based first `before` line covered; 0 when the hunk adds to an empty file. */
  beforeStart: number
  beforeCount: number
  afterStart: number
  afterCount: number
  lines: DiffLine[]
}

export interface LineDiff {
  hunks: DiffHunk[]
  added: number
  removed: number
  /** No hunks at all — the two texts are line-for-line identical. */
  unchanged: boolean
  /** The comparison was too large to run exactly; the middle is one replacement. */
  truncated: boolean
}

/** Unchanged lines shown either side of a change. */
export const DIFF_CONTEXT_LINES = 3

/**
 * Ceiling on the LCS table, in cells. 4M ≈ a 2000×2000-line comparison, which
 * is far past any Tool source that compiles inside the bundle cap — and past
 * the point where an exact diff helps a human anyway.
 */
const MAX_CELLS = 4_000_000

/**
 * Split for diffing. Line endings are normalized (a Windows-authored file and a
 * Unix-authored one that read identically must diff as identical), and the empty
 * string after a trailing newline is dropped so "a\n" is one line, not two.
 */
function splitLines(text: string): string[] {
  // An empty file is zero lines, not one empty one — otherwise creating a file
  // reads as "removed a blank line, added everything".
  if (text === '') return []
  const normalized = text.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

interface Op {
  kind: DiffLineKind
  text: string
  before: number | null
  after: number | null
}

/**
 * The op list for two already-trimmed line arrays, in output order.
 * `beforeOffset`/`afterOffset` are how many lines were trimmed off the head, so
 * the line numbers come out absolute.
 */
function lcsOps(a: string[], b: string[], beforeOffset: number, afterOffset: number): Op[] {
  const n = a.length
  const m = b.length
  const width = m + 1
  // dp[i][j] = length of the LCS of a[i..] and b[j..]. Filled backwards so the
  // forward walk below can pick the branch that keeps the most common lines.
  const dp = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] =
        a[i] === b[j]
          ? dp[(i + 1) * width + j + 1] + 1
          : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1])
    }
  }

  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'context', text: a[i], before: beforeOffset + i + 1, after: afterOffset + j + 1 })
      i++
      j++
    } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
      // Removals before additions on a tie, so a replaced line reads
      // "-old / +new" rather than the other way round.
      ops.push({ kind: 'remove', text: a[i], before: beforeOffset + i + 1, after: null })
      i++
    } else {
      ops.push({ kind: 'add', text: b[j], before: null, after: afterOffset + j + 1 })
      j++
    }
  }
  while (i < n) {
    ops.push({ kind: 'remove', text: a[i], before: beforeOffset + i + 1, after: null })
    i++
  }
  while (j < m) {
    ops.push({ kind: 'add', text: b[j], before: null, after: afterOffset + j + 1 })
    j++
  }
  return ops
}

/** The whole middle as a replacement, for a comparison too big to run exactly. */
function replaceOps(a: string[], b: string[], beforeOffset: number, afterOffset: number): Op[] {
  return [
    ...a.map((text, index) => ({
      kind: 'remove' as const,
      text,
      before: beforeOffset + index + 1,
      after: null,
    })),
    ...b.map((text, index) => ({
      kind: 'add' as const,
      text,
      before: null,
      after: afterOffset + index + 1,
    })),
  ]
}

/** Group changed ops into hunks, each padded with `context` unchanged lines. */
function buildHunks(ops: Op[], context: number): DiffHunk[] {
  const changed: number[] = []
  ops.forEach((op, index) => {
    if (op.kind !== 'context') changed.push(index)
  })
  if (changed.length === 0) return []

  // Expand every change by `context` either side, then merge ranges that touch
  // or overlap — two edits three lines apart belong in one hunk, not two that
  // print the same lines twice.
  const ranges: Array<{ start: number; end: number }> = []
  for (const index of changed) {
    const start = Math.max(0, index - context)
    const end = Math.min(ops.length - 1, index + context)
    const last = ranges[ranges.length - 1]
    if (last && start <= last.end + 1) last.end = Math.max(last.end, end)
    else ranges.push({ start, end })
  }

  return ranges.map(({ start, end }) => {
    const lines = ops.slice(start, end + 1).map((op) => ({
      kind: op.kind,
      text: op.text,
      before: op.before,
      after: op.after,
    }))
    const beforeLines = lines.filter((line) => line.before !== null)
    const afterLines = lines.filter((line) => line.after !== null)
    return {
      // A hunk made purely of additions has no `before` line to start at; 0 is
      // what unified diff itself writes for that case.
      beforeStart: beforeLines.length > 0 ? (beforeLines[0].before as number) : 0,
      beforeCount: beforeLines.length,
      afterStart: afterLines.length > 0 ? (afterLines[0].after as number) : 0,
      afterCount: afterLines.length,
      lines,
    }
  })
}

/**
 * Diff two texts by line. `context` is how many unchanged lines frame each
 * change (default `DIFF_CONTEXT_LINES`); pass 0 for changes only.
 */
export function diffLines(
  before: string,
  after: string,
  options?: { context?: number },
): LineDiff {
  const context = Math.max(0, Math.trunc(options?.context ?? DIFF_CONTEXT_LINES))
  const a = splitLines(before)
  const b = splitLines(after)

  // Trim the common head, then the common tail of what is left. Both halves are
  // pure context, so they cost nothing to keep and everything to compare.
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++
  }

  const midA = a.slice(head, a.length - tail)
  const midB = b.slice(head, b.length - tail)
  const truncated = midA.length * midB.length > MAX_CELLS

  const headOps: Op[] = a.slice(0, head).map((text, index) => ({
    kind: 'context' as const,
    text,
    before: index + 1,
    after: index + 1,
  }))
  const midOps = truncated
    ? replaceOps(midA, midB, head, head)
    : lcsOps(midA, midB, head, head)
  const tailOps: Op[] = a.slice(a.length - tail).map((text, index) => ({
    kind: 'context' as const,
    text,
    before: a.length - tail + index + 1,
    after: b.length - tail + index + 1,
  }))

  const ops = [...headOps, ...midOps, ...tailOps]
  const hunks = buildHunks(ops, context)
  return {
    hunks,
    added: ops.filter((op) => op.kind === 'add').length,
    removed: ops.filter((op) => op.kind === 'remove').length,
    unchanged: hunks.length === 0,
    truncated,
  }
}
