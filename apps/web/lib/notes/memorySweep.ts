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
//
// A judge stands on both sides of the chat call (lib/judge). BEFORE: a note
// that changed is first asked whether it still states every stored claim and
// adds no fact beyond them — a typo fix does, and its rows are restamped to the
// new mtime instead of spending an extraction. AFTER: every extracted claim is
// checked against the note — one the note does not state (the model inferred or
// invented it) or that cannot be read without the note ("they signed in March")
// is dropped before it is stored, because a claim is handed to agents as the
// answer. No verdict changes nothing: the note is extracted, the claim is kept.

import prisma from '@/lib/prisma'
import type { Context } from '@/lib/notes/store'
import { getVault } from '@/lib/notes/vaultCache'
import { splitFrontmatter } from '@/lib/notes/shared/markdown'
import { aiConfigured, aiModelName, chat, extractJsonObject } from '@/lib/notes/ai'
import { embedTexts, embeddingsConfig } from '@/lib/notes/embeddings'
import { vectorLiteral } from '@/lib/notes/vectorStage'
import { coerceClaims, MAX_CLAIMS_PER_NOTE, yieldsMemories } from '@/lib/notes/shared/memories'
import { logger } from '@/lib/logger'
import { decide, decideMany } from '@/lib/judge/client'
import { noulOf } from '@/lib/judge/shared/types'
import {
  CLAIM_QUESTIONS,
  CLAIM_STANDALONE_FLOOR,
  CLAIM_STATED_FLOOR,
  CLAIM_STILL_STATED,
  CLAIMS_COVER_BELOW,
  CLAIMS_COVER_QUESTION,
} from '@/lib/judge/shared/questions'

/** Chat calls per run. */
const MAX_NOTES_PER_RUN = 50
/** Characters of a note the extractor reads. */
const EXTRACT_CHARS = 8000
const EMBED_BATCH = 64
/** Edited notes one run asks the judge about before extracting. */
const MAX_COVER_CHECKS_PER_RUN = 300
const JUDGE_DEADLINE_MS = 8_000

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
  /** Edited notes whose stored claims still stood — restamped, not re-extracted. */
  unchanged: number
  /** Extracted claims the judge found the note does not state, or that do not stand alone. */
  rejected: number
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

/** Do the claims stored from a note's previous save still say everything the note says? */
async function claimsStillStand(body: string, stored: string[]): Promise<boolean> {
  if (stored.length === 0) return false
  const questions = Object.fromEntries([
    ['cover', CLAIMS_COVER_QUESTION] as const,
    ...stored.map((text, i) => [`s${i}`, { ...CLAIM_QUESTIONS.stated, instructions: `Does the note state this: "${text}"` }] as const),
  ])
  const answers = await decide({ note: body.slice(0, EXTRACT_CHARS), statements: stored }, questions, { deadlineMs: JUDGE_DEADLINE_MS, patient: true })
  const cover = noulOf(answers, 'cover')
  if (cover === undefined || cover >= CLAIMS_COVER_BELOW) return false
  return stored.every((_, i) => (noulOf(answers, `s${i}`) ?? 0) >= CLAIM_STILL_STATED)
}

/** The extracted claims the note actually states and that stand alone. Unjudged claims are kept. */
async function verifiedClaims(body: string, claims: string[]): Promise<string[]> {
  if (claims.length === 0) return claims
  const note = body.slice(0, EXTRACT_CHARS)
  const answers = await decideMany(
    claims.map((statement) => ({ state: { note, statement }, questions: CLAIM_QUESTIONS })),
    { deadlineMs: JUDGE_DEADLINE_MS, patient: true },
  )
  return claims.filter((_, i) => {
    const stated = noulOf(answers[i], 'stated')
    const standalone = noulOf(answers[i], 'standalone')
    return (stated === undefined || stated >= CLAIM_STATED_FLOOR) && (standalone === undefined || standalone >= CLAIM_STANDALONE_FLOOR)
  })
}

/** Extract and embed memories for one space or all. */
export async function memorySweep(spaceId?: string): Promise<MemorySweepResult> {
  const pruned = await pruneOrphanMemories(spaceId)
  if (!aiConfigured()) return { configured: false, notes: 0, claims: 0, embedded: 0, unchanged: 0, rejected: 0, remaining: 0, pruned }
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
  let unchanged = 0
  let rejected = 0
  let coverChecks = MAX_COVER_CHECKS_PER_RUN
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
      const body = bodyByPath.get(m.path) ?? ''
      // An edit that changed no fact keeps its claims: restamp, spend nothing.
      if (storedMtime.has(m.path) && coverChecks > 0) {
        coverChecks -= 1
        const previous = await prisma.contextMemory.findMany({
          where: { spaceId: context.spaceId, ownerKey: context.ownerKey, path: m.path, text: { not: '' } },
          select: { text: true },
          orderBy: { seq: 'asc' },
        })
        if (await claimsStillStand(body, previous.map((r) => r.text))) {
          await prisma.contextMemory.updateMany({
            where: { spaceId: context.spaceId, ownerKey: context.ownerKey, path: m.path },
            data: { mtime: BigInt(m.mtime) },
          })
          unchanged += 1
          continue
        }
      }
      if (budget <= 0) {
        remaining += 1
        continue
      }
      budget -= 1
      let extracted: string[]
      try {
        const raw = await extractClaims(m.title, m.path, m.frontmatter.type, body)
        extracted = await verifiedClaims(body, raw)
        rejected += raw.length - extracted.length
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
  return { configured: true, notes, claims, embedded, unchanged, rejected, remaining, pruned }
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
