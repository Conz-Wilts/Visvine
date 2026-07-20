// Roam-style backlinks. Given a target note and every note in a space, find the
// notes that reference it and the surrounding passage (the "context excerpt"):
//   - Linked references: notes that link to the target via an OKF markdown link,
//     each with the block of text the link sits in.
//   - Unlinked references: notes whose body mentions the target's *title* as plain
//     text (not yet a link), so the user can turn the mention into a real link.
// Pure — no fs/DOM — so it runs in the main process (local notes) and the renderer
// (the in-renderer company brain) alike, and is unit-testable.

import { splitFrontmatter, resolveOkfLink } from './markdown'
import type { RawNote, NoteMeta } from './types'

export interface LinkedReference {
  fromPath: string // the note that links to the target
  fromTitle: string
  date: number // the source note's last-modified time (epoch ms)
  excerpt: string // the full containing block, link syntax stripped to display text
}

export interface UnlinkedReference {
  fromPath: string // the note that mentions the target's title in plain text
  fromTitle: string
  date: number // the source note's last-modified time (epoch ms)
  excerpt: string // the full containing block, link syntax stripped to display text
}

export interface References {
  linked: LinkedReference[]
  unlinked: UnlinkedReference[]
}

// Captures a well-formed markdown link: [text](href) or [text](href "title").
// group 1 = link text, group 2 = href, match[0] = the whole span (for masking).
// Skips image links (![alt](src)) via the leading negative lookbehind.
const LINK_RE = /(?<!!)\[([^\]]*)\]\(([^)\s"]+)(?:\s+"[^"]*")?\)/g

// Unlinked mentions shorter than this are too noisy to be useful.
const MIN_TITLE_LEN = 3

function titleOf(path: string, titleByPath: Map<string, string>): string {
  const title = titleByPath.get(path)
  if (title !== undefined) return title
  return path.replace(/\.md$/i, '').split('/').pop() ?? path
}

// The passage that contains `index`: for list items and headings, just that line
// (a long list has no blank lines, so the paragraph rule would swallow the whole
// list); otherwise the blank-line-delimited paragraph, falling back to the whole
// body when there are no blank lines.
function blockAround(body: string, index: number): string {
  const lineStart = body.lastIndexOf('\n', index - 1) + 1
  const lineEndRel = body.indexOf('\n', index)
  const lineEnd = lineEndRel === -1 ? body.length : lineEndRel
  const line = body.slice(lineStart, lineEnd)
  if (/^\s*(?:#{1,6}\s|(?:[-*+]|\d+[.)])\s)/.test(line)) return line

  const before = body.lastIndexOf('\n\n', index)
  const start = before === -1 ? 0 : before + 2
  const afterRel = body.indexOf('\n\n', index)
  const end = afterRel === -1 ? body.length : afterRel
  return body.slice(start, end)
}

// Turn a raw block into its excerpt: strip markdown syntax down to plain display
// text (headings, list/task markers, blockquotes, emphasis, inline code, images,
// links) and collapse runs of whitespace. The whole block is kept — no truncation
// — so the reference shows the full passage it came from.
function makeExcerpt(block: string): string {
  return (
    block
      .split('\n')
      // Line prefixes: heading hashes, blockquote '>', list bullets / numbers,
      // and task-list checkboxes — stripped before lines are joined.
      .map((line) => line.replace(/^\s*(?:#{1,6}\s+|(?:>\s*)+|(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)/, ''))
      .join(' ')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images → alt text
      .replace(LINK_RE, '$1') // links → link text
      .replace(/(\*\*|__)(.+?)\1/g, '$2') // bold
      .replace(/(?<![\w*])(\*|_)([^*_]+)\1(?![\w*])/g, '$2') // italic
      .replace(/~~(.+?)~~/g, '$1') // strikethrough
      .replace(/`([^`]+)`/g, '$1') // inline code
      .replace(/\s+/g, ' ')
      .trim()
  )
}

// Replace every markdown-link span with same-length spaces, so a title search
// won't match inside a link's text/href and block offsets stay aligned.
function maskLinks(body: string): string {
  let masked = body
  for (const match of body.matchAll(LINK_RE)) {
    const start = match.index ?? 0
    masked =
      masked.slice(0, start) + ' '.repeat(match[0].length) + masked.slice(start + match[0].length)
  }
  return masked
}

// Escape a string for literal use inside a RegExp.
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Turn the first plain-text mention of `title` in `body` into a markdown link to
// `targetPath`. "Plain-text" means outside any existing markdown link (link spans
// are masked before searching) and whole-word. Returns the new body, or null when
// there is no eligible mention (e.g. the title only ever appears already linked).
export function linkFirstMention(body: string, title: string, targetPath: string): string | null {
  if (title.trim().length < MIN_TITLE_LEN) return null
  const re = new RegExp(`(?<![\\w])${escapeRegExp(title)}(?![\\w])`, 'i')
  const match = re.exec(maskLinks(body))
  if (!match) return null
  const start = match.index
  return body.slice(0, start) + `[${title}](/${targetPath})` + body.slice(start + match[0].length)
}

export function computeReferences(
  notes: RawNote[],
  targetPath: string,
  metas: NoteMeta[]
): References {
  const titleByPath = new Map(metas.map((m) => [m.path, m.title]))
  const targetTitle = titleOf(targetPath, titleByPath).trim()
  const linked: LinkedReference[] = []
  const unlinked: UnlinkedReference[] = []
  // Whole-word, case-insensitive title matcher (internal spaces are fine; the
  // lookarounds only forbid word characters touching either edge).
  const titleRe =
    targetTitle.length >= MIN_TITLE_LEN
      ? new RegExp(`(?<![\\w])${escapeRegExp(targetTitle)}(?![\\w])`, 'gi')
      : null

  for (const note of notes) {
    if (note.path === targetPath) continue
    const { body } = splitFrontmatter(note.content)
    const fromTitle = titleOf(note.path, titleByPath)

    // Linked: every markdown link in this note that resolves to the target.
    const seenLinked = new Set<string>()
    for (const match of body.matchAll(LINK_RE)) {
      const resolved = resolveOkfLink(match[2], note.path)
      if (resolved !== targetPath) continue
      const block = blockAround(body, match.index ?? 0)
      const excerpt = makeExcerpt(block)
      if (excerpt && !seenLinked.has(excerpt)) {
        seenLinked.add(excerpt)
        linked.push({ fromPath: note.path, fromTitle, date: note.mtime, excerpt })
      }
    }

    // Unlinked: plain-text title mentions outside of any link span.
    if (titleRe) {
      const masked = maskLinks(body)
      const seenUnlinked = new Set<string>()
      for (const match of masked.matchAll(titleRe)) {
        const block = blockAround(body, match.index ?? 0)
        const excerpt = makeExcerpt(block)
        if (excerpt && !seenUnlinked.has(excerpt)) {
          seenUnlinked.add(excerpt)
          unlinked.push({ fromPath: note.path, fromTitle, date: note.mtime, excerpt })
        }
      }
    }
  }

  return { linked, unlinked }
}
