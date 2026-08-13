/**
 * The single create/update/delete path for every context edge — manual links and
 * all auto triggers (RSVP -> attended, event -> hosting, intro -> introduced,
 * bulk import). Routing everything here gives us one dedup rule and one place to
 * reason about provenance.
 */
import { revalidateTag } from 'next/cache';
import prisma from '../../prisma';
import type { LinkOrigin } from '../../types';
import { normalizeRelationship, pairKeyFor } from './relationships';

// revalidateTag throws outside a Next.js request scope (tests, one-off scripts).
// Edges are best-effort cache busts, so swallow that — never let it break a write.
function bustContextCache(): void {
  try {
    revalidateTag('context-data-v2', { expire: 0 });
  } catch {
    /* outside request scope */
  }
}

export interface UpsertLinkInput {
  spaceId: string;
  sourceId: string;
  targetId: string;
  relationship: string;
  origin: LinkOrigin;
  since?: string | null;
  metadata?: Record<string, unknown>;
  createdBy?: string | null;
  originRef?: string | null;
  /** Set false to skip the cache bust (e.g. batched callers). Default true. */
  revalidate?: boolean;
}

/**
 * Create or update an edge, deduped on (spaceId, pairKey, relationship).
 *
 * Promotion: a `manual` write adopts an existing auto row in place (origin ->
 * manual, records createdBy) so the human assertion wins and there is never a
 * duplicate row. An auto write only refreshes since/metadata and NEVER touches
 * origin/createdBy, so it can't demote a manual/promoted edge.
 */
export async function upsertLink(input: UpsertLinkInput) {
  const relationship = normalizeRelationship(input.relationship) || 'related';
  const pairKey = pairKeyFor(input.sourceId, input.targetId);

  const link = await prisma.link.upsert({
    where: {
      link_identity: { spaceId: input.spaceId, pairKey, relationship },
    },
    create: {
      sourceId: input.sourceId,
      targetId: input.targetId,
      relationship,
      pairKey,
      origin: input.origin,
      spaceId: input.spaceId,
      since: input.since ?? null,
      metadata: (input.metadata as object) ?? {},
      createdBy: input.createdBy ?? null,
      originRef: input.originRef ?? null,
    },
    update:
      input.origin === 'manual'
        ? {
            origin: 'manual',
            createdBy: input.createdBy ?? undefined,
            metadata: (input.metadata as object) ?? undefined,
            since: input.since ?? undefined,
          }
        : {
            metadata: (input.metadata as object) ?? undefined,
            since: input.since ?? undefined,
          },
  });

  if (input.revalidate !== false) bustContextCache();
  return link;
}

/**
 * Remove a system-generated edge by its provenance. Scoped to (origin,
 * originRef) so it can NEVER delete a manual or promoted edge — a promoted edge
 * has origin 'manual', so this deleteMany matches 0 rows for it.
 */
export async function removeAutoLink(
  spaceId: string,
  origin: LinkOrigin,
  originRef: string,
): Promise<number> {
  const res = await prisma.link.deleteMany({ where: { spaceId, origin, originRef } });
  if (res.count > 0) bustContextCache();
  return res.count;
}

/**
 * Remove an edge by its (undirected) endpoints + optional relationship. Backs the
 * manual delete path; admins may remove any edge regardless of origin. Omitting
 * `relationship` removes every edge between the pair.
 */
export async function removeLink(
  spaceId: string,
  sourceId: string,
  targetId: string,
  relationship?: string,
): Promise<number> {
  const pairKey = pairKeyFor(sourceId, targetId);
  const res = await prisma.link.deleteMany({
    where: {
      spaceId,
      pairKey,
      ...(relationship ? { relationship: normalizeRelationship(relationship) } : {}),
    },
  });
  if (res.count > 0) bustContextCache();
  return res.count;
}
