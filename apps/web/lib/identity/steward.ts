/**
 * Steward operations over canonical identities: list the review queue, merge two
 * identities into one, and split a node off into a fresh identity (an "unmerge").
 * These back the /console review surface and the /api/identities/* routes. Every
 * action is audited in `identity_resolutions` and is reversible.
 */

import prisma from '../prisma';
import { Prisma } from '@prisma/client';
import { logger } from '../logger';
import { nameKey, normalizeEmail, linkedinHandle, websiteDomain } from './normalize';

export interface SuggestionItem {
  nodeId: string;
  nodeName: string;
  nodeCommunityId: string | null;
  nodeCommunityName: string | null;
  /** The node's CURRENT identity (what a "same" merge would fold into the candidate). */
  nodeIdentityId: string | null;
  candidateIdentityId: string;
  candidateName: string;
  candidateCommunities: string[];
  confidence: number;
  reason: string;
}

/**
 * Pending suggestions: 'suggested' audit rows whose (nodeId, identityId) pair has
 * not since been confirmed/rejected/merged/split. Super admins see everything; a
 * community admin sees only suggestions whose node lives in one of their communities.
 */
export async function listSuggestions(opts: { communityIds?: string[] | null } = {}): Promise<SuggestionItem[]> {
  const suggested = await prisma.identityResolution.findMany({
    where: { decision: 'suggested' },
    orderBy: { createdAt: 'desc' },
    select: { nodeId: true, identityId: true, confidence: true, reason: true },
    take: 500,
  });
  if (suggested.length === 0) return [];

  // Drop pairs already acted on.
  const nodeIds = [...new Set(suggested.map((s) => s.nodeId))];
  const resolvedRows = await prisma.identityResolution.findMany({
    where: { nodeId: { in: nodeIds }, decision: { in: ['confirmed', 'rejected', 'merged', 'split'] } },
    select: { nodeId: true, identityId: true },
  });
  const resolvedPairs = new Set(resolvedRows.map((r) => `${r.nodeId}|${r.identityId ?? ''}`));

  const pending = suggested.filter(
    (s) => s.identityId && !resolvedPairs.has(`${s.nodeId}|${s.identityId}`),
  );
  if (pending.length === 0) return [];

  // Enrich with node + candidate-identity detail.
  const nodes = await prisma.node.findMany({
    where: { id: { in: [...new Set(pending.map((p) => p.nodeId))] } },
    select: { id: true, name: true, communityId: true, identityId: true, community: { select: { name: true } } },
  });
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const candidateIds = [...new Set(pending.map((p) => p.identityId!).filter(Boolean))];
  const identities = await prisma.identity.findMany({
    where: { id: { in: candidateIds } },
    select: { id: true, canonicalName: true, nodes: { select: { community: { select: { name: true } } } } },
  });
  const idMap = new Map(identities.map((i) => [i.id, i]));

  const items: SuggestionItem[] = [];
  for (const p of pending) {
    const node = nodeMap.get(p.nodeId);
    const cand = idMap.get(p.identityId!);
    if (!node || !cand) continue; // node or candidate deleted since
    if (opts.communityIds && !(node.communityId && opts.communityIds.includes(node.communityId))) continue;
    items.push({
      nodeId: node.id,
      nodeName: node.name,
      nodeCommunityId: node.communityId,
      nodeCommunityName: node.community?.name ?? null,
      nodeIdentityId: node.identityId,
      candidateIdentityId: cand.id,
      candidateName: cand.canonicalName,
      candidateCommunities: [...new Set(cand.nodes.map((n) => n.community?.name).filter((x): x is string => !!x))],
      confidence: p.confidence,
      reason: p.reason,
    });
  }
  return items;
}

/**
 * Merge `sourceId` into `targetId`: repoint every node, fill the target's missing
 * fields from the source (survivorship: verified wins, then fill gaps), delete the
 * source, and audit each repointed node as 'merged'. No-op if the ids are equal.
 */
export async function mergeIdentities(
  sourceId: string,
  targetId: string,
  opts: { actorUserId?: string | null } = {},
): Promise<{ ok: boolean; movedNodes: number; error?: string }> {
  if (sourceId === targetId) return { ok: false, movedNodes: 0, error: 'same identity' };

  return prisma.$transaction(async (tx) => {
    const [source, target] = await Promise.all([
      tx.identity.findUnique({ where: { id: sourceId } }),
      tx.identity.findUnique({ where: { id: targetId } }),
    ]);
    if (!source || !target) return { ok: false, movedNodes: 0, error: 'identity not found' };
    if (source.kind !== target.kind) return { ok: false, movedNodes: 0, error: 'kind mismatch' };

    // Survivorship — target survives; adopt source values only where target is empty.
    const data: Prisma.IdentityUpdateInput = {};
    if (!target.email && source.email) data.email = source.email;
    if (!target.linkedinHandle && source.linkedinHandle) data.linkedinHandle = source.linkedinHandle;
    if (!target.websiteDomain && source.websiteDomain) data.websiteDomain = source.websiteDomain;
    if (!target.imageUrl && source.imageUrl) data.imageUrl = source.imageUrl;
    if (!target.verified && source.verified) data.verified = true;
    if (!target.userId && source.userId) data.userId = source.userId;
    const tMeta = { ...((source.metadata as Record<string, unknown>) ?? {}), ...((target.metadata as Record<string, unknown>) ?? {}) };
    data.metadata = tMeta as Prisma.InputJsonValue;
    if (Object.keys(data).length) await tx.identity.update({ where: { id: targetId }, data });

    // Repoint nodes and audit them.
    const movedNodes = await tx.node.findMany({ where: { identityId: sourceId }, select: { id: true } });
    await tx.node.updateMany({ where: { identityId: sourceId }, data: { identityId: targetId } });
    if (movedNodes.length) {
      await tx.identityResolution.createMany({
        data: movedNodes.map((n) => ({
          nodeId: n.id,
          identityId: targetId,
          decision: 'merged',
          confidence: 1,
          reason: `merged ${sourceId} → ${targetId}`,
          actorUserId: opts.actorUserId ?? null,
        })),
      });
    }

    // Source's userId must be freed before delete if we adopted it (unique column).
    if (data.userId && source.userId) {
      await tx.identity.update({ where: { id: sourceId }, data: { userId: null } });
    }
    await tx.identity.delete({ where: { id: sourceId } });

    return { ok: true, movedNodes: movedNodes.length };
  });
}

/**
 * Split a node off its current identity into a fresh one (an unmerge). Records a
 * 'split' anti-match against the old identity so resolution never re-merges them.
 */
export async function splitNodeToNewIdentity(
  nodeId: string,
  opts: { actorUserId?: string | null } = {},
): Promise<{ ok: boolean; identityId?: string; error?: string }> {
  const node = await prisma.node.findUnique({
    where: { id: nodeId },
    select: { id: true, type: true, name: true, location: true, url: true, imageUrl: true, metadata: true, identityId: true },
  });
  if (!node) return { ok: false, error: 'node not found' };

  const t = node.type.toLowerCase();
  const kind = t === 'organization' || t === 'organisation' || t === 'org' || t === 'group' ? 'organization' : 'person';
  const meta = (node.metadata as Record<string, unknown>) ?? {};
  const oldIdentityId = node.identityId;

  const fresh = await prisma.identity.create({
    data: {
      kind,
      canonicalName: node.name,
      nameKey: nameKey(node.name),
      email: kind === 'person' ? normalizeEmail((meta.email as string) ?? null) : null,
      linkedinHandle: linkedinHandle((meta.linkedinUrl as string) ?? null),
      websiteDomain: kind === 'organization' ? websiteDomain((meta.website as string) ?? node.url ?? null) : null,
      imageUrl: node.imageUrl ?? null,
      metadata: {
        ...(meta.companyName ? { company: meta.companyName } : {}),
        ...(node.location ? { location: node.location } : {}),
      } as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  await prisma.node.update({ where: { id: nodeId }, data: { identityId: fresh.id } });

  const auditRows: Prisma.IdentityResolutionCreateManyInput[] = [
    { nodeId, identityId: fresh.id, decision: 'created', confidence: 1, reason: 'split to new identity', actorUserId: opts.actorUserId ?? null },
  ];
  if (oldIdentityId) {
    // Anti-match: never re-merge this node back into the identity it was split from.
    auditRows.push({ nodeId, identityId: oldIdentityId, decision: 'split', confidence: 0, reason: 'split off', actorUserId: opts.actorUserId ?? null });
  }
  await prisma.identityResolution.createMany({ data: auditRows });

  // Clean up an identity that now has no nodes.
  if (oldIdentityId) {
    const remaining = await prisma.node.count({ where: { identityId: oldIdentityId } });
    if (remaining === 0) {
      await prisma.identity.delete({ where: { id: oldIdentityId } }).catch((err) => logger.error('identity.split.cleanup.failed', { err }));
    }
  }

  return { ok: true, identityId: fresh.id };
}
