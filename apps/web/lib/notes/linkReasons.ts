// AI tier of the link-reason feature: turn the excerpts stored on context links
// (metadata.context, written by lib/notes/entityLinks.ts) into a short human
// phrase saying WHY the two entities are linked — "collaborated on the
// connectors project" — stored beside the excerpts as metadata.context.reason.
//
// Runs fire-and-forget after note saves (no queue exists; the deploy is a
// long-lived Node server, so a detached promise completes reliably) and is
// idempotent on the excerpt set: reasonHash records the combinedExcerptHash the
// reason was generated from, so an unchanged note never re-triggers the LLM.
// A row whose excerpts carry no real reason still gets its hash stamped, so it
// isn't retried forever. Unkeyed env → aiConfigured() is false and callers
// skip scheduling entirely (repo convention: AI degrades to off, silently).

import { revalidateTag } from 'next/cache'
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { aiConfigured, aiModelName, chat, extractJsonObject } from '@/lib/notes/ai'
import {
  combinedExcerptHash,
  mergeContextMeta,
  readLinkContextMeta,
  type LinkContextMeta,
} from '@/lib/notes/context/linkReason'

// Matches entityLinks.ts's CONTEXT_ORIGIN — redeclared here (not imported) so
// entityLinks can schedule runs from this module without a circular import.
const CONTEXT_ORIGIN = 'context'

const BATCH_SIZE = 20
const MAX_REASON_LEN = 120

interface Candidate {
  id: number
  metadata: unknown
  context: LinkContextMeta
  hash: string
  sourceLabel: string
  targetLabel: string
}

function bustContextCache(): void {
  try {
    revalidateTag('context-data-v2', { expire: 0 })
  } catch {
    /* outside request scope */
  }
}

const SYSTEM_PROMPT =
  'You annotate a community directory. For each item you are given two entities ' +
  'and the passage(s) from notes that link them. Return ONLY JSON of the shape ' +
  '{"reasons": [{"id": "<id>", "reason": "<phrase>"}]} with one entry per item. ' +
  'Each reason is one short phrase (at most 12 words, no trailing period) stating ' +
  'WHY the two are linked according to the passages — e.g. "collaborated on the ' +
  'connectors project" or "met at the founders summit". Use an empty string when ' +
  'the passages give no real reason beyond the mention itself. Never invent facts.'

function promptFor(batch: Candidate[]): string {
  return batch
    .map((c) => {
      const excerpts = Object.entries(c.context.excerpts)
        .map(([path, e]) => `  from ${path}: ${e.text}`)
        .join('\n')
      return `id: ${c.id}\nA: ${c.sourceLabel}\nB: ${c.targetLabel}\npassages:\n${excerpts}`
    })
    .join('\n---\n')
}

function coerceReasons(raw: string): Map<string, string> {
  const obj = extractJsonObject(raw) as { reasons?: unknown }
  const out = new Map<string, string>()
  if (!Array.isArray(obj?.reasons)) return out
  for (const entry of obj.reasons) {
    const id = (entry as Record<string, unknown>)?.id
    const reason = (entry as Record<string, unknown>)?.reason
    if ((typeof id === 'string' || typeof id === 'number') && typeof reason === 'string') {
      out.set(String(id), reason.trim().replace(/\.$/, '').slice(0, MAX_REASON_LEN))
    }
  }
  return out
}

/**
 * Generate reasons for every context link in the community whose excerpt set
 * has changed since its reason was last written. Throws only on programmer
 * error — LLM/API failures are logged per batch and skipped, so a partial run
 * still lands what it produced.
 */
export async function generateLinkReasons(
  communityId: string,
): Promise<{ considered: number; updated: number }> {
  const links = await prisma.link.findMany({
    where: { communityId, origin: CONTEXT_ORIGIN },
    select: { id: true, sourceId: true, targetId: true, metadata: true },
  })

  const nodeIds = [...new Set(links.flatMap((l) => [l.sourceId, l.targetId]))]
  const nodes = await prisma.node.findMany({
    where: { id: { in: nodeIds } },
    select: { id: true, name: true, type: true },
  })
  const labelById = new Map(nodes.map((n) => [n.id, `${n.name} (${n.type})`]))

  const candidates: Candidate[] = []
  for (const link of links) {
    const context = readLinkContextMeta(link.metadata)
    if (!context) continue
    const hash = combinedExcerptHash(context)
    if (!hash || context.reasonHash === hash) continue
    candidates.push({
      id: link.id,
      metadata: link.metadata,
      context,
      hash,
      sourceLabel: labelById.get(link.sourceId) ?? link.sourceId,
      targetLabel: labelById.get(link.targetId) ?? link.targetId,
    })
  }

  let updated = 0
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE)
    let reasons: Map<string, string>
    try {
      reasons = coerceReasons(
        await chat([
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: promptFor(batch) },
        ]),
      )
    } catch (err) {
      logger.error('notes.linkReasons.batch.failed', { err, communityId })
      continue
    }
    for (const candidate of batch) {
      const reason = reasons.get(String(candidate.id))
      if (reason === undefined) continue
      // Empty reason still stamps the hash — "nothing to say" is an answer,
      // and stamping it stops the row from being retried on every save.
      const context: LinkContextMeta = {
        ...candidate.context,
        ...(reason ? { reason } : { reason: undefined }),
        reasonHash: candidate.hash,
        reasonModel: aiModelName(),
        updatedAt: new Date().toISOString(),
      }
      await prisma.link.update({
        where: { id: candidate.id },
        data: { metadata: mergeContextMeta(candidate.metadata, context) as object },
      })
      updated += 1
    }
  }

  if (updated > 0) bustContextCache()
  return { considered: candidates.length, updated }
}

// One in-flight run per community: overlapping saves during a run don't stack
// LLM calls — a save landing mid-run still mismatches reasonHash, so the next
// trigger picks it up.
const running = new Set<string>()

/**
 * Fire-and-forget wrapper for the save path. No-op while a run for the
 * community is already in flight or when AI is unconfigured.
 */
export function scheduleLinkReasons(communityId: string): void {
  if (!aiConfigured()) return
  if (running.has(communityId)) return
  running.add(communityId)
  void generateLinkReasons(communityId)
    .catch((err) => {
      logger.error('notes.linkReasons.failed', { err, communityId })
    })
    .finally(() => {
      running.delete(communityId)
    })
}
