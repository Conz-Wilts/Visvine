// The derived-memory sweep: extract one-sentence claims from every note whose
// memories are missing or from an older save, embed them, and store them. Run
// nightly (lib/notes/nightly.ts) and by hand (`pnpm db:memories`); the same
// implementation either way.
//
// Extraction is one chat call per note, so a run is BOUNDED (MAX_NOTES_PER_RUN)
// and takes the most recently changed notes first — the sweep catches up over
// nights rather than spending a whole budget in one. Idempotent: a note whose
// stored mtime matches is skipped, a note that yielded nothing is remembered
// with an empty marker row so it is not re-read every night, and orphans (a
// deleted or renamed note's rows the write path failed to drop) are pruned
// first. Embedding is separate from extraction and separately keyed: claims
// stored without a vector (no OPENROUTER_API_KEY at the time) still rank by full
// text, and a later run with a key embeds them without re-extracting.

import prisma from '@/lib/prisma'
import type { Context } from '@/lib/notes/store'
import { getVault } from '@/lib/notes/vaultCache'
import { splitFrontmatter } from '@/lib/notes/shared/markdown'
import { aiConfigured, aiModelName, chat, extractJsonObject } from '@/lib/notes/ai'
import { embedTexts, embeddingsConfig } from '@/lib/notes/embeddings'
import { vectorLiteral } from '@/lib/notes/vectorStage'
import { coerceClaims, MAX_CLAIMS_PER_NOTE, yieldsMemories } from '@/lib/notes/shared/memories'
import { logger } from '@/lib/logger'

/** Chat calls per run. */
const MAX_NOTES_PER_RUN = 50
/** Characters of a note the extractor reads. */
const EXTRACT_CHARS = 8000
const EMBED_BATCH = 64

const SYSTEM =
  'You extract durable facts from one markdown note in a shared knowledge base about people, companies, decisions, meetings and events. ' +
  'Return ONLY JSON of the shape {"claims": string[]}.\n' +
  'Rules:\n' +
  `1. Each claim is ONE sentence stating ONE fact the note asserts. At most ${MAX_CLAIMS_PER_NOTE}; fewer is better. Return [] if the note states nothing factual.\n` +
  '2. Self-contained: name the subject (a person, company, decision) in every claim. Never "he", "it", "they", "this".\n' +
  '3. Only what the note says. No inference, no advice, no summary of the note as a document, nothing about formatting or links.\n' +
  '4. Keep dates, numbers and names exactly as written. Under 30 words each.'

export interface MemorySweepResult {
  /** False when OPENROUTER_API_KEY is unset — nothing was extracted (pruning still ran). */
  configured: boolean
  /** Notes read by the model this run. */
  notes: number
  /** Claims stored this run. */
  claims: number
  /** Claims given a vector this run (including earlier claims stored without one). */
  embedded: number
  /** Notes still stale when the per-run bound was reached. */
  remaining: number
  pruned: number
}

async function extractClaims(title: string, path: string, type: string | undefined, body: string): Promise<string[]> {
  const raw = await chat([
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `Path: ${path}\nTitle: ${title}${type ? `\nType: ${type}` : ''}\n\n${body.slice(0, EXTRACT_CHARS)}`,
    },
  ])
  return coerceClaims(extractJsonObject(raw))
}

/** Extract and embed memories for one space or all. */
export async function memorySweep(spaceId?: string): Promise<MemorySweepResult> {
  const pruned = await pruneOrphanMemories(spaceId)
  if (!aiConfigured()) return { configured: false, notes: 0, claims: 0, embedded: 0, remaining: 0, pruned }
  const where = spaceId ? { spaceId } : {}
  const model = aiModelName()

  const contextRows = await prisma.contextNote.groupBy({
    by: ['spaceId', 'ownerKey'],
    where: { ...where, deletedAt: null },
  })
  const contexts: Context[] = contextRows.map((b) => ({ spaceId: b.spaceId, ownerKey: b.ownerKey }))

  let notes = 0
  let claims = 0
  let remaining = 0
  let budget = MAX_NOTES_PER_RUN
  for (const context of contexts) {
    const { raws, metas } = await getVault(context)
    const bodyByPath = new Map(raws.map((r) => [r.path, splitFrontmatter(r.content).body]))

    const stored = await prisma.contextMemory.findMany({
      where: { spaceId: context.spaceId, ownerKey: context.ownerKey },
      select: { path: true, mtime: true },
      distinct: ['path'],
    })
    const storedMtime = new Map(stored.map((r) => [r.path, Number(r.mtime)]))
    const stale = metas
      .filter((m) => yieldsMemories(m, bodyByPath.get(m.path) ?? '') && storedMtime.get(m.path) !== m.mtime)
      .sort((a, b) => b.mtime - a.mtime)

    for (const m of stale) {
      if (budget <= 0) {
        remaining += 1
        continue
      }
      budget -= 1
      let extracted: string[]
      try {
        extracted = await extractClaims(m.title, m.path, m.frontmatter.type, bodyByPath.get(m.path) ?? '')
      } catch (err) {
        // One unreadable note must not end the run; it stays stale for next time.
        logger.warn('notes.memories.extract_failed', { err, path: m.path })
        continue
      }
      // The marker row (seq 0, empty text) records that a note with no claims
      // was read at this mtime. Replacing the note's rows wholesale is what
      // keeps a shrunken claim list from leaving old seqs behind.
      const rows = extracted.length ? extracted : ['']
      await prisma.$transaction([
        prisma.contextMemory.deleteMany({ where: { spaceId: context.spaceId, ownerKey: context.ownerKey, path: m.path } }),
        prisma.contextMemory.createMany({
          data: rows.map((text, seq) => ({
            spaceId: context.spaceId,
            ownerKey: context.ownerKey,
            path: m.path,
            seq,
            text,
            model,
            mtime: BigInt(m.mtime),
          })),
        }),
      ])
      notes += 1
      claims += extracted.length
    }
  }

  const embedded = await embedMemories(spaceId)
  return { configured: true, notes, claims, embedded, remaining, pruned }
}

/** Give a vector to every claim stored without one on the current model. */
async function embedMemories(spaceId?: string): Promise<number> {
  const config = embeddingsConfig()
  if (!config) return 0
  const where = spaceId ? { spaceId } : {}
  const rows = await prisma.contextMemory.findMany({
    where: { ...where, text: { not: '' }, OR: [{ embedModel: null }, { embedModel: { not: config.model } }] },
    select: { id: true, text: true },
    orderBy: { id: 'asc' },
  })
  for (let i = 0; i < rows.length; i += EMBED_BATCH) {
    const batch = rows.slice(i, i + EMBED_BATCH)
    const vectors = await embedTexts(batch.map((r) => r.text))
    await Promise.all(
      batch.map(
        (r, j) => prisma.$executeRaw`
          UPDATE context_memories
          SET embed_model = ${config.model}, embedding = ${vectorLiteral(vectors[j])}::vector
          WHERE id = ${r.id}`,
      ),
    )
  }
  return rows.length
}

/**
 * Delete memories whose note is gone — the reconciling half of a lifecycle
 * whose eager half is lib/notes/projections.ts#dropDerived, for the same reason
 * embedSweep has one: the table cannot carry a foreign key to a note.
 */
async function pruneOrphanMemories(spaceId?: string): Promise<number> {
  if (spaceId) {
    return prisma.$executeRaw`
      DELETE FROM context_memories m
      WHERE m.space_id = ${spaceId}
        AND NOT EXISTS (
          SELECT 1 FROM context_notes n
          WHERE n.space_id = m.space_id AND n.owner_key = m.owner_key AND n.path = m.path AND n.deleted_at IS NULL
        )`
  }
  return prisma.$executeRaw`
    DELETE FROM context_memories m
    WHERE NOT EXISTS (
      SELECT 1 FROM context_notes n
      WHERE n.space_id = m.space_id AND n.owner_key = m.owner_key AND n.path = m.path AND n.deleted_at IS NULL
    )`
}
