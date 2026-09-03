// The derived memory tier, pure half: which notes yield memories, and what a
// model's extraction is allowed to become.
//
// A memory is one sentence the note states as a fact — self-contained, subject
// named, nothing the reader has to look up. The note stays the record; the
// memory is the retrieval-sized copy of one claim in it, keyed back to the note
// so a hit hydrates to the source and inherits its lifecycle. Extraction runs on
// the server (lib/notes/memorySweep.ts); everything about the output that can
// be checked without a model is checked here.

import type { NoteMeta } from './types'
import { isIndexPath } from './indexNote'

/** The most claims one note keeps — past this the note is the better unit. */
export const MAX_CLAIMS_PER_NOTE = 12
/** A claim longer than this is an excerpt, not a memory. */
const MAX_CLAIM_CHARS = 240
/** Notes shorter than this say nothing a memory would compress. */
const MIN_BODY_CHARS = 120
/** Folders holding configuration, code and the platform's own manuals. */
const CONFIG_FOLDERS = ['connectors', 'models', 'agents', 'settings', 'tools', 'actions', 'recipes']

/**
 * Whether a note is worth extracting from. Index notes are folder listings; the
 * configuration folders hold machine-read notes (a connector's perimeter, a
 * Tool's code); a note may also opt out with `memories: false`.
 */
export function yieldsMemories(meta: Pick<NoteMeta, 'path' | 'frontmatter'>, body: string): boolean {
  if (isIndexPath(meta.path)) return false
  if (meta.frontmatter.memories === false) return false
  const top = meta.path.split('/')[0]
  if (meta.path.includes('/') && CONFIG_FOLDERS.includes(top)) return false
  return body.trim().length >= MIN_BODY_CHARS
}

/**
 * Validate a model's `{ claims: string[] }`: strings only, whitespace
 * collapsed, list markers stripped, empty / over-long / duplicate claims
 * dropped, capped. Returns [] for anything malformed — a note the model
 * could not read yields nothing rather than something wrong.
 */
export function coerceClaims(raw: unknown): string[] {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const items = Array.isArray(r.claims) ? r.claims : []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of items) {
    if (typeof item !== 'string') continue
    const text = item.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').replace(/\s+/g, ' ').trim()
    if (!text || text.length > MAX_CLAIM_CHARS) continue
    const key = text.toLowerCase().replace(/[.!?]+$/, '')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(text)
    if (out.length >= MAX_CLAIMS_PER_NOTE) break
  }
  return out
}
