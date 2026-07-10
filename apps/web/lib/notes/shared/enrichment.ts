// Enrichment — abstract reusable insight from personal notes into the shared
// brain: synthesise, never copy. Ported from blackbird-brain's
// src/shared/enrichment.ts. Pure candidate-selection + untrusted-LLM-output
// coercion; the server pass (lib/notes/enrich.ts) runs the LLM and applies the
// writes. In Visvine the sources are the CALLER's own personal brain (never
// another user's), preserving the personal-space privacy contract.

import { normalizeKey } from './markdown'

export interface EnrichmentSource {
  path: string
  type?: string
  title: string
  text: string
  sha256: string
  mtime: number
}

/** Which sources have already been enriched (path → last-enriched content hash). */
export interface EnrichmentLedger {
  seen: Record<string, string>
}

export interface EnrichmentCandidate {
  sourcePath: string
  type?: string
  title: string
  text: string
  sha256: string
}

export interface SelectOptions {
  trigger: 'on-demand' | 'scheduled'
  /** Restrict to a single source path. */
  only?: string
  /** Only sources modified at/after this epoch ms. */
  since?: number
}

/** Idempotent candidate selection (unchanged sources are skipped via the ledger). */
export function selectEnrichmentCandidates(
  sources: EnrichmentSource[],
  ledger: EnrichmentLedger,
  opts: SelectOptions,
): EnrichmentCandidate[] {
  return sources
    .filter((s) => (opts.only ? s.path === opts.only : true))
    .filter((s) => (opts.since != null ? s.mtime >= opts.since : true))
    .filter((s) => ledger.seen[s.path] !== s.sha256)
    .filter((s) => s.text.trim().length > 0)
    .map((s) => ({ sourcePath: s.path, type: s.type, title: s.title, text: s.text, sha256: s.sha256 }))
}

/** Group candidates describing the same concept (by normalized title) so a batch merges rather than fragments. */
export function groupCandidates(candidates: EnrichmentCandidate[]): EnrichmentCandidate[][] {
  const groups = new Map<string, EnrichmentCandidate[]>()
  for (const c of candidates) {
    const key = normalizeKey(c.title)
    const arr = groups.get(key) ?? []
    arr.push(c)
    groups.set(key, arr)
  }
  return [...groups.values()]
}

export interface EnrichmentOutput {
  action: 'new_note' | 'append_log'
  insight: string
  /** Required for append_log — a shared-brain note path (without .md). */
  targetId?: string
  /** Required for new_note. */
  newNote?: { type: string; title: string }
  links: string[]
  sources: string[]
}

export interface CoerceContext {
  /** Ids (paths without .md) that append_log may target. */
  validTargetIds: Set<string>
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/**
 * Validate/repair an untrusted LLM enrichment output. Enforces the guardrails:
 * allowed action, a valid append target, and a non-empty abstracted insight.
 * Returns null to drop the item.
 */
export function coerceEnrichmentOutput(raw: unknown, ctx: CoerceContext): EnrichmentOutput | null {
  const r = isRecord(raw) ? raw : {}
  if (r.hasInsight === false) return null
  const action = r.action === 'new_context' ? 'new_note' : r.action
  if (action !== 'new_note' && action !== 'append_log') return null

  const insight = typeof r.insight === 'string' ? r.insight.trim() : ''
  if (!insight) return null

  const links = strArray(r.links)
  const sources = strArray(r.sources)

  if (action === 'append_log') {
    const targetId = typeof r.targetId === 'string' ? r.targetId.replace(/\.md$/i, '') : ''
    if (!targetId || !ctx.validTargetIds.has(targetId)) return null
    return { action, insight, targetId, links, sources }
  }

  const nn = isRecord(r.newNote) ? r.newNote : isRecord(r.newContext) ? r.newContext : {}
  const title = typeof nn.title === 'string' ? nn.title.trim() : ''
  if (!title) return null
  const type = typeof nn.type === 'string' && nn.type.trim() ? nn.type.trim() : 'insight'
  return { action, insight, newNote: { type, title }, links, sources }
}
