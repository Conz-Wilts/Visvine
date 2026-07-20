// The enrichment runner — the port of blackbird-brain's src/server/enrichment.ts,
// re-scoped for multi-tenant privacy: it distills the CALLING user's own personal
// brain (never anyone else's) into the community's shared brain. The LLM ABSTRACTS
// reusable insight upward — synthesise, never copy — the output is coerced against
// guardrails, provenance-stamped, and applied through the gated write path as the
// caller. A sha256 ledger (per personal brain) makes the pass idempotent.

import { createHash } from 'crypto'
import * as store from './store'
import { SHARED_OWNER_KEY, type Brain } from './store'
import { chat, extractJsonObject, aiConfigured, aiModelName } from './ai'
import { readJson, writeJson } from './sidecar'
import { visibleVault, writeGated, appendLogGated } from './brainService'
import { buildNoteIndex } from './shared/graph'
import { joinFrontmatter, splitFrontmatter } from './shared/markdown'
import { provenanceRef, stampProvenance } from './shared/noteLog'
import {
  coerceEnrichmentOutput,
  selectEnrichmentCandidates,
  type EnrichmentCandidate,
  type EnrichmentLedger,
  type EnrichmentOutput,
  type EnrichmentSource,
  type SelectOptions,
} from './shared/enrichment'
import type { BrainPrincipal, WriteResult } from './shared/brainTypes'

// One ledger per TARGET community (stored on the personal brain), so distilling
// into community A doesn't mark a note "seen" for community B.
function ledgerName(targetCommunityId: string): string {
  return `enrichment-state.${targetCommunityId.replace(/[^a-zA-Z0-9_-]+/g, '-')}.json`
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}
function firstLine(s: string): string {
  return (s.split('\n').find((l) => l.trim()) ?? s).trim().slice(0, 200)
}
function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'insight'
}

const SYSTEM = `You distill a member's personal working notes into knowledge worth sharing with their community.
Given one personal note and a list of existing shared notes, decide whether the note contains a REUSABLE insight others would benefit from — a lesson, pattern, thesis, or durable fact. Private, personal, or ephemeral content (todos, feelings, scheduling, half-thoughts) has no insight.
ABSTRACT upward: rewrite the insight in general, shareable terms. Never copy private specifics (names of uninvolved people, private numbers) unless they are the insight.
Respond with ONLY a JSON object:
{"hasInsight": boolean,
 "action": "new_note" | "append_log",
 "insight": "the abstracted insight, 1-3 paragraphs of markdown",
 "targetId": "exact id of the existing shared note to append to (append_log only)",
 "newNote": {"type": "insight|playbook|thesis|note", "title": "short title"},
 "links": [], "sources": []}
Prefer append_log when an existing shared note already covers the concept; otherwise new_note.`

function userMsg(c: EnrichmentCandidate, targets: { id: string; title: string }[]): string {
  const list = targets.map((t) => `- ${t.id} — ${t.title}`).join('\n')
  return `Personal note "${c.title}" (type: ${c.type ?? 'note'}):\n${c.text}\n\nExisting shared notes you may append to (use the exact id):\n${list || '(none)'}`
}

/** Apply an abstracted insight through the gated write path, as the caller. */
async function applyOutput(
  p: BrainPrincipal,
  shared: Brain,
  personalBrain: Brain,
  out: EnrichmentOutput,
  c: EnrichmentCandidate,
): Promise<WriteResult> {
  const src = provenanceRef(`${personalBrain.communityId}/${c.sourcePath}`)
  if (out.action === 'new_note') {
    const fm = stampProvenance(
      {
        type: out.newNote!.type,
        title: out.newNote!.title,
        description: firstLine(out.insight),
        author: p.name,
        timestamp: new Date().toISOString(),
      },
      { source: src, sources: out.sources },
    )
    const path = `insights/${slugify(out.newNote!.title)}.md`
    const existing = await store.readNoteOrNull(shared, path)
    if (existing !== null) {
      // The concept already exists — append rather than clobber.
      return appendLogGated(p, shared, path, `${out.insight} (source: ${src})`, 'ai-enrich', aiModelName())
    }
    return writeGated(
      p,
      shared,
      path,
      joinFrontmatter(fm, `# ${out.newNote!.title}\n\n${out.insight}\n`),
      'ai-enrich',
      aiModelName(),
    )
  }
  return appendLogGated(p, shared, `${out.targetId!}.md`, `${out.insight} (source: ${src})`, 'ai-enrich', aiModelName())
}

export interface EnrichmentRunResult {
  applied: number
  considered: number
}

/**
 * Distill the caller's personal brain into the community's shared brain.
 * No-op when AI is unconfigured.
 */
export async function runEnrichment(
  p: BrainPrincipal,
  personalBrain: Brain,
  opts: SelectOptions,
): Promise<EnrichmentRunResult> {
  if (!aiConfigured()) return { applied: 0, considered: 0 }
  const shared: Brain = { communityId: p.communityId, ownerKey: SHARED_OWNER_KEY }

  const raws = await store.listRaw(personalBrain)
  const metas = buildNoteIndex(raws)
  const bodyByPath = new Map(raws.map((r) => [r.path, splitFrontmatter(r.content).body]))

  const sources: EnrichmentSource[] = metas.map((m) => {
    const text = bodyByPath.get(m.path) ?? ''
    return {
      path: m.path,
      type: m.frontmatter.type,
      title: m.title,
      text,
      sha256: sha256(text),
      mtime: m.mtime,
    }
  })

  const ledger = await readJson<EnrichmentLedger>(personalBrain, ledgerName(p.communityId), { seen: {} })
  const candidates = selectEnrichmentCandidates(sources, ledger, opts)

  // Targets the LLM may append to: what the caller can see in the shared brain.
  const { metas: sharedMetas } = await visibleVault(p, shared)
  const targets = sharedMetas.map((m) => ({ id: m.path.replace(/\.md$/i, ''), title: m.title }))
  const validTargetIds = new Set(targets.map((t) => t.id))

  let applied = 0
  for (const c of candidates) {
    let out: EnrichmentOutput | null = null
    try {
      const resp = await chat([
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userMsg(c, targets) },
      ])
      out = coerceEnrichmentOutput(extractJsonObject(resp), { validTargetIds })
    } catch {
      out = null
    }
    if (out) {
      try {
        const r = await applyOutput(p, shared, personalBrain, out, c)
        if (r.status === 'applied') applied++
      } catch {
        /* a failed write skips this candidate; the ledger still marks it seen */
      }
    }
    ledger.seen[c.sourcePath] = c.sha256
  }
  await writeJson(personalBrain, ledgerName(p.communityId), ledger)
  return { applied, considered: candidates.length }
}
