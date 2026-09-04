// The pure chunker for context NOTES — the retrieval unit behind
// `context_note_chunks` (lib/notes/embedSweep.ts writes them,
// lib/notes/chunkStage.ts ranks them). A whole-note vector blurs a long note
// into one point; a query about one paragraph of a 4 KB brief then loses to a
// short note that is vaguely about the same thing. Chunks keep the paragraph
// findable, and the fusion folds every chunk hit back onto its note
// (shared/retrieval.ts), so a result is still a note — carrying the passage
// that matched as its `passage`.
//
// Structure-first, size-second: a note splits at its headings, so a chunk is
// one section and never straddles two topics; a section longer than the
// target then packs paragraphs up to it with a short overlap. Every chunk's
// embedded text is prefixed with its breadcrumb — the note's title and the
// heading path — because the vector for "Q3 targets" under "## Halter" should
// know it is about Halter. The stored `text` is the prose alone, for snippets.
//
// Pure — no Prisma/Node/DOM imports. Deterministic: the same note always
// yields the same chunks, which is what lets `mtime` stand in for a content
// hash when deciding what to re-embed.

import { CHILDREN_OPEN, CHILDREN_CLOSE } from './indexNote'

/** Target characters per chunk. Sections shorter than this stay whole. */
export const NOTE_CHUNK_CHARS = 1200
/** A single paragraph longer than this is split at sentence ends, then hard. */
export const NOTE_CHUNK_MAX_CHARS = 1800
/** Tail of the previous chunk carried into the next, inside one section. */
export const NOTE_CHUNK_OVERLAP = 120
/** Chunks per note beyond this are dropped — the head is still indexed. */
export const MAX_NOTE_CHUNKS = 64
/** A section this short is folded into its neighbour rather than embedded alone. */
const MIN_SECTION_CHARS = 80

interface NoteChunk {
  /** 0-based order within the note. */
  seq: number
  /** Heading path this chunk sits under, `>`-joined; '' for the preamble. */
  heading: string
  /** The prose itself — what a snippet shows. */
  text: string
  /** Breadcrumb + prose — what is embedded. Same prose, more context. */
  embedText: string
}

export interface NoteChunking {
  chunks: NoteChunk[]
  /** True when MAX_NOTE_CHUNKS dropped sections. */
  truncated: boolean
}

interface Section {
  /** Heading path, outermost first. */
  path: string[]
  lines: string[]
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/
const CHILDREN_RE = new RegExp(
  `${CHILDREN_OPEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${CHILDREN_CLOSE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
  'g',
)

/**
 * The body as a reader sees it: the machine-maintained child list of an index
 * note is a table of contents, not prose, and would otherwise be a chunk of
 * link text that matches every query naming a child.
 */
function stripMachineBlocks(body: string): string {
  return body.replace(CHILDREN_RE, '').replace(/<!--[\s\S]*?-->/g, '')
}

/** Split the body into heading-delimited sections; fenced code never opens one. */
function sections(body: string): Section[] {
  const out: Section[] = []
  let current: Section = { path: [], lines: [] }
  const stack: { level: number; title: string }[] = []
  let inFence = false
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    const heading = inFence ? null : HEADING_RE.exec(line)
    if (!heading) {
      current.lines.push(line)
      continue
    }
    out.push(current)
    const level = heading[1].length
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop()
    stack.push({ level, title: heading[2].trim() })
    current = { path: stack.map((s) => s.title), lines: [] }
  }
  out.push(current)
  return out.filter((s) => s.lines.join('\n').trim() !== '')
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(\[])/).filter((s) => s.trim())
}

/** Paragraphs, with any single paragraph over the hard cap split at sentence ends. */
function paragraphs(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(/\n\s*\n/)) {
    const p = raw.trim()
    if (!p) continue
    if (p.length <= NOTE_CHUNK_MAX_CHARS) {
      out.push(p)
      continue
    }
    let current = ''
    for (const s of sentences(p)) {
      if (current && current.length + s.length + 1 > NOTE_CHUNK_MAX_CHARS) {
        out.push(current)
        current = s
      } else {
        current = current ? `${current} ${s}` : s
      }
      // A sentence that is itself over the cap (a URL list, a table row) is cut hard.
      while (current.length > NOTE_CHUNK_MAX_CHARS) {
        out.push(current.slice(0, NOTE_CHUNK_MAX_CHARS))
        current = current.slice(NOTE_CHUNK_MAX_CHARS)
      }
    }
    if (current) out.push(current)
  }
  return out
}

/** Pack one section's paragraphs to the target size with overlap between packs. */
function packSection(text: string): string[] {
  const packs: string[] = []
  let current = ''
  for (const p of paragraphs(text)) {
    if (current && current.length + p.length + 2 > NOTE_CHUNK_CHARS) {
      packs.push(current)
      const tail = current.slice(-NOTE_CHUNK_OVERLAP)
      const cut = tail.search(/\s/)
      const carried = (cut === -1 ? tail : tail.slice(cut + 1)).trim()
      // The overlap is continuity, never a reason to breach the hard cap: a
      // paragraph already cut to size takes no tail.
      current = carried && carried.length + p.length + 2 <= NOTE_CHUNK_MAX_CHARS ? `${carried}\n\n${p}` : p
    } else {
      current = current ? `${current}\n\n${p}` : p
    }
  }
  if (current.trim()) packs.push(current)
  return packs
}

function breadcrumb(title: string, heading: string): string {
  return heading ? `${title} > ${heading}` : title
}

/**
 * Chunk one note. `title` is the note's display title (frontmatter or
 * filename); `body` is the markdown after the frontmatter. An empty body still
 * yields one chunk of the title, so a stub is findable by name.
 */
export function chunkNote(title: string, body: string): NoteChunking {
  const clean = stripMachineBlocks(body).trim()
  const pieces: { heading: string; text: string }[] = []

  // Sections too short to stand alone ride with the previous one under the
  // same breadcrumb rules: a two-line "## Links" is context for the section
  // before it, not a chunk that outranks it on every query naming a link.
  let pending: { heading: string; text: string } | null = null
  for (const s of sections(clean)) {
    const heading = s.path.join(' > ')
    const text = s.lines.join('\n').trim()
    if (pending && pending.text.length + text.length + 2 <= NOTE_CHUNK_CHARS && text.length < MIN_SECTION_CHARS) {
      pending = { heading: pending.heading, text: `${pending.text}\n\n${text}` }
      continue
    }
    if (pending) pieces.push(pending)
    pending = { heading, text }
  }
  if (pending) pieces.push(pending)

  const all: NoteChunk[] = []
  for (const piece of pieces) {
    for (const text of packSection(piece.text)) {
      all.push({
        seq: all.length,
        heading: piece.heading,
        text,
        embedText: `${breadcrumb(title, piece.heading)}\n${text}`,
      })
    }
  }
  if (all.length === 0) {
    all.push({ seq: 0, heading: '', text: '', embedText: title })
  }
  return { chunks: all.slice(0, MAX_NOTE_CHUNKS), truncated: all.length > MAX_NOTE_CHUNKS }
}
