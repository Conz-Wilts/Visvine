// Dated `## Log` stamping + capture-line format. Every gated append writes an attributed,
// newest-first entry into the note's own history; quick captures append dated
// lines to the personal monthly log. Pure — no fs/DB access.

import { joinFrontmatter, parseFrontmatter, splitFrontmatter } from './markdown'
import type { NoteFrontmatter } from './types'

// ## Log entries

export interface NoteLogEntry {
  /** YYYY-MM-DD. */
  date: string
  actor: string
  role?: string
  summary: string
}

/** Local YYYY-MM-DD for an epoch-ms instant. */
export function toDateString(epochMs: number): string {
  const d = new Date(epochMs)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Insert a newest-first entry under a `## Log` heading, creating the section if absent. */
function insertUnderLog(body: string, entry: string): string {
  const lines = body.split('\n')
  const idx = lines.findIndex((l) => /^##\s+Log\s*$/i.test(l.trim()))
  if (idx === -1) {
    const trimmed = body.replace(/\s+$/, '')
    return `${trimmed}\n\n## Log\n\n${entry}\n`
  }
  // Insert just after the heading (and any single following blank line), newest first.
  let insertAt = idx + 1
  if (lines[insertAt]?.trim() === '') insertAt += 1
  lines.splice(insertAt, 0, entry, '')
  return lines.join('\n')
}

/** Append a dated `## Log` entry and bump `timestamp`; returns the full note markdown. */
export function appendNoteLogEntry(md: string, e: NoteLogEntry): string {
  const fm: NoteFrontmatter = { ...parseFrontmatter(md), timestamp: new Date().toISOString() }
  const { body } = splitFrontmatter(md)
  const heading = `### ${e.date} — ${e.actor}${e.role ? ` (${e.role})` : ''}`
  const entry = `${heading}\n${e.summary}`
  return joinFrontmatter(fm, insertUnderLog(body, entry))
}

// capture lines (personal monthly log)

export interface CaptureEntry {
  /** Epoch ms. */
  at: number
  author: string
  text: string
  refs?: string[]
  tags?: string[]
}

export interface ParsedCapture {
  /** "YYYY-MM-DD HH:MM". */
  when: string
  author: string
  text: string
  refs: string[]
  tags: string[]
}

/** Local "YYYY-MM-DD HH:MM" for an epoch-ms instant. */
export function toDateTimeString(epochMs: number): string {
  const d = new Date(epochMs)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Format one capture: `- <when> — <author> — <text>` plus optional refs/tags lines. */
export function formatCaptureEntry(e: CaptureEntry): string {
  const text = e.text.replace(/\s+/g, ' ').trim()
  const lines = [`- ${toDateTimeString(e.at)} — ${e.author} — ${text}`]
  if (e.refs && e.refs.length) lines.push(`  refs: ${e.refs.join(', ')}`)
  if (e.tags && e.tags.length) lines.push(`  tags: ${e.tags.join(', ')}`)
  return lines.join('\n')
}

const ENTRY_RE = /^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) — ([^—]+?) — (.*)$/

/** Parse a personal log back into entries (best-effort; refs/tags from continuation lines). */
export function parseCaptureEntries(md: string): ParsedCapture[] {
  const out: ParsedCapture[] = []
  const lines = md.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = ENTRY_RE.exec(lines[i])
    if (!m) continue
    const entry: ParsedCapture = { when: m[1], author: m[2].trim(), text: m[3].trim(), refs: [], tags: [] }
    for (let j = i + 1; j < lines.length; j++) {
      const cont = lines[j]
      const refM = /^\s+refs:\s*(.+)$/.exec(cont)
      const tagM = /^\s+tags:\s*(.+)$/.exec(cont)
      if (refM) entry.refs = refM[1].split(',').map((s) => s.trim()).filter(Boolean)
      else if (tagM) entry.tags = tagM[1].split(',').map((s) => s.trim()).filter(Boolean)
      else break
    }
    out.push(entry)
  }
  return out
}

// provenance

/** A reference back to the originating context note (access-gated at resolve time). */
export function provenanceRef(sourcePath: string): string {
  return `context:${sourcePath.replace(/\.md$/i, '')}`
}

/** Merge provenance sources into frontmatter, deduped. */
export function stampProvenance(
  fm: NoteFrontmatter,
  p: { source?: string; sources?: string[] },
): NoteFrontmatter {
  const existing = Array.isArray(fm.sources) ? (fm.sources as unknown[]).map(String) : []
  const added = [...(p.source ? [p.source] : []), ...(p.sources ?? [])]
  return { ...fm, sources: Array.from(new Set([...existing, ...added])) }
}
