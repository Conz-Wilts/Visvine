// The memory lifecycle of a context note: what state a claim is in, how
// confident it is, when it expires, and what it replaced.
//
// A note is the unit of MEMORY in this system, and memory that is merely stored
// is not memory that is useful — a superseded decision retrieved at full
// strength is worse than no decision at all. So every note carries a lifecycle
// in its frontmatter (the source of truth, like every other note field), the
// clean pass keeps that lifecycle honest, and retrieval down-ranks what the
// lifecycle says is no longer current.
//
// Pure — no Prisma/Node/DOM imports. The vocabulary lives here rather than in
// review.ts because three unrelated layers need it: the checks that maintain it
// (shared/review.ts), the fusion that weighs it (shared/retrieval.ts) and the
// agent-facing surfaces that display it (lib/actions/defs/context.ts).

import type { NoteFrontmatter, NoteMeta } from './types'

/**
 * The `status:` vocabulary. `stale` and `archived` predate this module (the
 * review pass has always auto-set `stale`); the rest give a claim the states it
 * actually moves through — asserted, agreed, replaced, retired, refused.
 *
 * An absent status reads as `active`: the overwhelming majority of notes are
 * plain current knowledge and should not have to say so.
 */
const NOTE_STATUSES = [
  'active',
  'proposed',
  'accepted',
  'stale',
  'superseded',
  'deprecated',
  'expired',
  'archived',
  'rejected',
] as const

export type NoteStatus = (typeof NOTE_STATUSES)[number]

/**
 * Statuses that mean "do not act on this as current truth". They are NOT
 * hidden: the note stays readable, linkable and searchable, because the reason
 * a decision was reversed is often the most valuable thing in a context. They
 * are down-ranked, and flagged wherever an agent sees them.
 */
const RETIRED_STATUSES: ReadonlySet<NoteStatus> = new Set([
  'stale',
  'superseded',
  'deprecated',
  'expired',
  'archived',
  'rejected',
])

/**
 * How much a status is trusted at retrieval time, as a multiplier on the fused
 * score. Deliberately coarse: this exists to stop a replaced answer outranking
 * its replacement, not to encode a precise decay curve. Nothing is zeroed —
 * a search for "why did we drop X" must still find the note that says so.
 */
const STATUS_WEIGHTS: Record<NoteStatus, number> = {
  active: 1,
  accepted: 1,
  proposed: 0.9,
  stale: 0.7,
  deprecated: 0.45,
  rejected: 0.45,
  superseded: 0.35,
  expired: 0.35,
  archived: 0.35,
}

/**
 * How sure the author was. Surfaced to readers and agents, and used by the
 * contradiction check to decide which side of a conflict to favour — but
 * deliberately NOT a ranking factor. Confidence is a property of the claim;
 * relevance is a property of the query, and multiplying the two makes a search
 * result impossible to explain.
 */
const CONFIDENCE_LEVELS = ['certain', 'likely', 'speculative'] as const

type Confidence = (typeof CONFIDENCE_LEVELS)[number]

const STATUS_SET: ReadonlySet<string> = new Set(NOTE_STATUSES)
const CONFIDENCE_SET: ReadonlySet<string> = new Set(CONFIDENCE_LEVELS)

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

/** The note's status, defaulting to `active`. Unknown spellings read as active. */
export function statusOf(fm: NoteFrontmatter): NoteStatus {
  const raw = str(fm.status)?.toLowerCase()
  return raw && STATUS_SET.has(raw) ? (raw as NoteStatus) : 'active'
}

/**
 * Lifecycle values that were written but are not in the vocabulary, described
 * for a human. A misspelled `status:` is the dangerous case: it reads as
 * `active`, so a note the author believed they had retired keeps ranking as
 * current truth. Reported by the review pass rather than guessed at.
 */
export function unknownLifecycleValues(fm: NoteFrontmatter): string[] {
  const out: string[] = []
  const status = str(fm.status)?.toLowerCase()
  if (status != null && !STATUS_SET.has(status)) {
    out.push(`status: "${status}" is not one of ${NOTE_STATUSES.join(' | ')} — it reads as active`)
  }
  const confidence = str(fm.confidence)?.toLowerCase()
  if (confidence != null && !CONFIDENCE_SET.has(confidence)) {
    out.push(`confidence: "${confidence}" is not one of ${CONFIDENCE_LEVELS.join(' | ')}`)
  }
  if (str(fm.expires) != null && expiresAtOf(fm) === null) {
    out.push(`expires: "${str(fm.expires)}" is not a date — the note will never retire itself`)
  }
  return out
}

export function isRetired(fm: NoteFrontmatter): boolean {
  return RETIRED_STATUSES.has(statusOf(fm))
}

function confidenceOf(fm: NoteFrontmatter): Confidence | null {
  const raw = str(fm.confidence)?.toLowerCase()
  return raw && CONFIDENCE_SET.has(raw) ? (raw as Confidence) : null
}

/**
 * Normalize one note reference as authors write them. Links in a body carry a
 * leading slash (`/people/craig.md`) and frontmatter refs are written both
 * ways; the `.md` suffix is routinely dropped. Resolution against the real
 * corpus happens in review.ts — this only canonicalizes the spelling.
 */
export function normalizeNoteRef(raw: string): string {
  const trimmed = raw.trim().replace(/^\/+/, '')
  if (trimmed === '') return ''
  return trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`
}

function refList(v: unknown): string[] {
  const items = Array.isArray(v) ? v : typeof v === 'string' ? [v] : []
  const out: string[] = []
  for (const item of items) {
    if (typeof item !== 'string') continue
    const ref = normalizeNoteRef(item)
    if (ref && !out.includes(ref)) out.push(ref)
  }
  return out
}

/** Notes this note replaces (`supersedes:` — a path or list of paths). */
export function supersedesOf(fm: NoteFrontmatter): string[] {
  return refList(fm.supersedes)
}

/** The note that replaced this one (`superseded_by:`), set by the clean pass. */
export function supersededByOf(fm: NoteFrontmatter): string | null {
  return refList(fm.superseded_by)[0] ?? null
}

/**
 * The note's expiry as epoch ms, or null when absent/unparseable. A bare date
 * (`2026-09-01`) means the END of that day: a note that expires "on the 1st" is
 * still good on the 1st, which is what everyone means when they write it.
 */
export function expiresAtOf(fm: NoteFrontmatter): number | null {
  const raw = str(fm.expires)
  if (!raw) return null
  const bareDate = /^\d{4}-\d{2}-\d{2}$/.test(raw)
  const parsed = Date.parse(bareDate ? `${raw}T23:59:59.999Z` : raw)
  return Number.isNaN(parsed) ? null : parsed
}

/** The lifecycle of a note in one object — what the agent surfaces report. */
export interface NoteLifecycle {
  status: NoteStatus
  confidence: Confidence | null
  expires: number | null
  supersedes: string[]
  supersededBy: string | null
}

export function lifecycleOf(fm: NoteFrontmatter): NoteLifecycle {
  return {
    status: statusOf(fm),
    confidence: confidenceOf(fm),
    expires: expiresAtOf(fm),
    supersedes: supersedesOf(fm),
    supersededBy: supersededByOf(fm),
  }
}

/** The retrieval multiplier for a note — see STATUS_WEIGHTS. */
export function retrievalWeight(meta: Pick<NoteMeta, 'frontmatter'>): number {
  return STATUS_WEIGHTS[statusOf(meta.frontmatter)]
}
