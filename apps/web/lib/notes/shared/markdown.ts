// Pure markdown helpers: frontmatter parsing and OKF link extraction.
// No fs/DOM access — safe to use from both main and renderer.

import * as yaml from 'yaml'
import type { NoteFrontmatter } from './types'

// Split a note's leading `---` YAML frontmatter from its markdown body.
export function splitFrontmatter(md: string): {
  frontmatter: string | null
  body: string
} {
  const lines = md.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') {
    return { frontmatter: null, body: md }
  }
  const end = lines.indexOf('---', 1)
  if (end === -1) {
    return { frontmatter: null, body: md }
  }
  return {
    frontmatter: lines.slice(1, end).join('\n'),
    body: lines
      .slice(end + 1)
      .join('\n')
      .replace(/^\n+/, '')
  }
}

// A note whose frontmatter lost its OPENING fence — `title: x` … `---` …
// body, which models writing notes often produce — with the fence put back.
// Only when every line above the first `---` reads as YAML (a `key:` line or a
// list item under one) and parses as a map; anything else is left as written.
export function restoreFrontmatterFence(md: string): string {
  const lines = md.split(/\r?\n/)
  if (lines[0]?.trim() === '---') return md
  const end = lines.findIndex((l) => l.trim() === '---')
  if (end < 1 || !/^[A-Za-z_][\w-]*:/.test(lines[0])) return md
  const head = lines.slice(0, end)
  if (!head.every((l) => /^[A-Za-z_][\w-]*:/.test(l) || /^\s+\S/.test(l) || l.trim() === '')) return md
  try {
    const parsed = yaml.parse(head.join('\n'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return md
  } catch {
    return md
  }
  return `---\n${md}`
}

// Parse a note's frontmatter into an object (empty object if absent/invalid).
export function parseFrontmatter(md: string): NoteFrontmatter {
  const { frontmatter } = splitFrontmatter(md)
  if (!frontmatter) {
    return {}
  }
  try {
    // logLevel 'error' silences YAML warnings — note frontmatter is arbitrary
    // user content (e.g. a `title: {{date}}` template) and shouldn't spam logs;
    // a genuine parse failure still falls through to {} below.
    return (yaml.parse(frontmatter, { logLevel: 'error' }) as NoteFrontmatter) ?? {}
  } catch {
    return {}
  }
}

// Serialize frontmatter + body back into a single markdown document. Omits the
// `---` block entirely when there are no frontmatter keys.
export function joinFrontmatter(frontmatter: NoteFrontmatter, body: string): string {
  const keys = Object.keys(frontmatter)
  if (keys.length === 0) {
    return body.trimEnd() + '\n'
  }
  const yamlText = yaml.stringify(frontmatter).trimEnd()
  return `---\n${yamlText}\n---\n\n${body.trimStart()}`.trimEnd() + '\n'
}

// Matches [text](href) — captures the href portion, stopping before optional
// title or closing paren. Skips image links (![alt](src)).
const MARKDOWN_LINK_RE = /(?<!!)\[[^\]]*\]\(([^)\s"]+)/g

// Extract OKF-style markdown link hrefs from a body. Skips external URLs and
// anchor-only links. Returned hrefs are unresolved (absolute or relative paths).
export function extractMarkdownLinks(body: string): string[] {
  const out: string[] = []
  for (const match of body.matchAll(MARKDOWN_LINK_RE)) {
    const href = match[1]
    if (
      href.startsWith('http://') ||
      href.startsWith('https://') ||
      href.startsWith('mailto:') ||
      href.startsWith('#')
    ) {
      continue
    }
    out.push(href)
  }
  return out
}

// Matches an inline Roam-style hashtag: a '#' at the start of the text or after
// whitespace, followed by a letter and then word chars / hyphens. The preceding-
// whitespace requirement excludes URL fragments ("page#frag") and the required
// leading letter excludes issue-style "#123"; an ATX heading ("# Title") is
// excluded too since its '#' is followed by a space. Capture group is the tag
// name without the leading '#'.
const HASHTAG_RE = /(?<=^|\s)#([A-Za-z][\w-]*)/g

// Extract inline hashtag names (without the '#') from a markdown body, in
// first-seen order with duplicates removed.
export function extractHashtags(body: string): string[] {
  const out: string[] = []
  for (const match of body.matchAll(HASHTAG_RE)) {
    out.push(match[1])
  }
  return unique(out)
}

function folderOf(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? '' : path.slice(0, idx)
}

// Resolve an OKF markdown link href to a notes-relative path.
// Absolute hrefs (starting with /) are treated as notes-root-relative.
// Relative hrefs are resolved from the folder of the source note.
export function resolveOkfLink(href: string, fromNotePath: string): string | null {
  const raw = href.startsWith('/')
    ? href.slice(1)
    : (() => {
        const folder = folderOf(fromNotePath)
        return folder ? `${folder}/${href}` : href
      })()

  const parts = raw.split('/')
  const resolved: string[] = []
  for (const part of parts) {
    if (part === '..') {
      resolved.pop()
    } else if (part !== '.' && part !== '') {
      resolved.push(part)
    }
  }
  const result = resolved.join('/')
  return result || null
}

// Normalize a name/path for case-insensitive lookup.
export function normalizeKey(value: string): string {
  return value.trim().toLowerCase()
}

// De-duplicate a list while preserving first-seen order.
export function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}
