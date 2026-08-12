/**
 * The member connection: an explicit, detachable link between a directory
 * person node and a registered User, routed through the canonical Identity
 * (Node.identityId → Identity.userId → User).
 *
 * A CONNECTED node is a member's presence in a community — it gets the Profile
 * tab and userId-based ownership. A DISCONNECTED node is a plain person-typed
 * context: renameable, profileless, and never silently re-attached (disconnect
 * writes a 'split' anti-match the resolver honours).
 *
 * This module is the only writer of member connections. Node.name stays a
 * community-local display label throughout — connecting never renames the node.
 */

import prisma from '../prisma';
import { logger } from '../logger';
import { entityKindOf } from '../notes/entities';
import { confirmIdentity } from './resolve';
import { normalizeEmail, nameKey } from './normalize';

export type ConnectError = 'not_found' | 'not_person' | 'duplicate' | 'identity_conflict';

export interface NodeConnection {
  userId: string;
  identityId: string;
  personId: string | null;
  isActive: boolean;
  name: string;
  email: string;
}

function isPersonNode(node: { type: string }): boolean {
  return entityKindOf(node.type) === 'person';
}

/**
 * The Identity that represents a registered User, creating or claiming one as
 * needed. Claim order: by userId, then by exact normalized email (claimed and
 * marked verified — the email is authenticated), else a fresh verified row.
 *
 * Throws when the email-matched Identity is already claimed by a DIFFERENT
 * user — that's a data conflict a human has to untangle, not something to
 * silently reassign.
 */
export async function ensureUserIdentity(userId: string): Promise<{ id: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true },
  });
  if (!user) throw new Error(`ensureUserIdentity: no user ${userId}`);

  const claimed = await prisma.identity.findUnique({ where: { userId }, select: { id: true } });
  if (claimed) return claimed;

  const email = normalizeEmail(user.email);
  if (email) {
    const byEmail = await prisma.identity.findFirst({
      where: { kind: 'person', email },
      select: { id: true, userId: true },
    });
    if (byEmail) {
      if (byEmail.userId && byEmail.userId !== userId) {
        throw new Error(
          `ensureUserIdentity: identity ${byEmail.id} (email ${email}) is claimed by another user`,
        );
      }
      await prisma.identity.update({
        where: { id: byEmail.id },
        data: { userId, verified: true },
      });
      return { id: byEmail.id };
    }
  }

  return prisma.identity.create({
    data: {
      kind: 'person',
      canonicalName: user.name,
      nameKey: nameKey(user.name),
      email,
      verified: true,
      userId,
    },
    select: { id: true },
  });
}

/**
 * Connect a person node to a registered User. One connected node per user per
 * community; the connection is recorded as a confirmed identity resolution so
 * the audit trail explains itself.
 */
export async function connectNodeToUser(
  nodeId: string,
  userId: string,
  opts: { actorUserId?: string | null; reason?: string } = {},
): Promise<{ ok: true; identityId: string } | { ok: false; error: ConnectError; message: string }> {
  const node = await prisma.node.findUnique({
    where: { id: nodeId },
    select: { id: true, type: true, communityId: true, identityId: true },
  });
  if (!node) return { ok: false, error: 'not_found', message: 'Node not found' };
  if (!isPersonNode(node)) {
    return { ok: false, error: 'not_person', message: 'Only person contexts can be connected to a member' };
  }

  let identity: { id: string };
  try {
    identity = await ensureUserIdentity(userId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Identity conflict';
    return { ok: false, error: 'identity_conflict', message };
  }

  // One member, one node, per community.
  if (node.communityId) {
    const rival = await prisma.node.findFirst({
      where: {
        communityId: node.communityId,
        identityId: identity.id,
        id: { not: nodeId },
      },
      select: { id: true, name: true },
    });
    if (rival) {
      return {
        ok: false,
        error: 'duplicate',
        message: `"${rival.name}" is already connected to this member in this space`,
      };
    }
  }

  await prisma.node.update({ where: { id: nodeId }, data: { identityId: identity.id } });
  await confirmIdentity(nodeId, identity.id, {
    actorUserId: opts.actorUserId ?? null,
    reason: opts.reason ?? 'connected to member',
  });
  return { ok: true, identityId: identity.id };
}

/**
 * Detach a node from its member. The 'split' anti-match keeps the resolver
 * from quietly re-attaching the pair on the next name/email coincidence; the
 * Identity and Person rows are untouched (other communities stay connected).
 */
export async function disconnectNode(
  nodeId: string,
  opts: { actorUserId?: string | null } = {},
): Promise<boolean> {
  const node = await prisma.node.findUnique({
    where: { id: nodeId },
    select: { identityId: true },
  });
  if (!node?.identityId) return false;

  await prisma.$transaction([
    prisma.node.update({ where: { id: nodeId }, data: { identityId: null } }),
    prisma.identityResolution.create({
      data: {
        nodeId,
        identityId: node.identityId,
        decision: 'split',
        confidence: 0,
        reason: 'disconnected from member',
        actorUserId: opts.actorUserId ?? null,
      },
    }),
  ]);
  return true;
}

/**
 * The single read path: node → identity → user (+ Person profile row).
 * Null when the node has no identity, the identity is unclaimed, or the user
 * row is gone — i.e. exactly when the node should behave as a plain context.
 */
export async function resolveNodeConnection(nodeId: string): Promise<NodeConnection | null> {
  const node = await prisma.node.findUnique({
    where: { id: nodeId },
    select: {
      identityId: true,
      identity: { select: { id: true, userId: true } },
    },
  });
  const userId = node?.identity?.userId;
  if (!node?.identityId || !userId) return null;

  const [user, person] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, isActive: true },
    }),
    prisma.person.findUnique({ where: { userId }, select: { id: true } }),
  ]);
  if (!user) return null;

  return {
    userId,
    identityId: node.identityId,
    personId: person?.id ?? null,
    isActive: user.isActive,
    name: user.name,
    email: user.email,
  };
}

/** The member's connected node in a community, or null. */
export async function findMemberNode(
  communityId: string,
  userId: string,
): Promise<{ id: string; name: string } | null> {
  return prisma.node.findFirst({
    where: { communityId, identity: { userId } },
    select: { id: true, name: true },
  });
}

/** Best-effort connect for callers whose primary write already succeeded. */
export async function connectNodeToUserSafe(
  nodeId: string,
  userId: string,
  opts: { actorUserId?: string | null; reason?: string } = {},
): Promise<void> {
  try {
    const result = await connectNodeToUser(nodeId, userId, opts);
    if (!result.ok) {
      logger.warn('identity.connection.skipped', { nodeId, userId, error: result.error, message: result.message });
    }
  } catch (err) {
    logger.error('identity.connection.failed', { err, nodeId, userId });
  }
}
