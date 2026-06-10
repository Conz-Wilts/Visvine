/**
 * Intro (warm-introduction) service — the double opt-in state machine.
 *
 *   pending ──approve(+endorse)──▶ approved ──accept──▶ connected
 *      │ introducer                  │ target
 *      └── decline                   └── decline   → declined (+ declinedBy)
 *
 * Authorization is always derived from the session's `personId` (the viewer's
 * person-node id), never from client-supplied ids. On `accept` we create a graph
 * Link so the two people show up in each other's network, and best-effort seed a
 * DM. Email notifications are fire-and-forget (no-ops without RESEND_API_KEY).
 */

import type { IntroRequest } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import type { SessionPayload } from '@/lib/session';
import { createDmConversation } from '@/lib/messages/conversationService';
import {
  sendIntroRequestedEmail,
  sendIntroForwardedEmail,
  sendIntroConnectedEmail,
} from '@/lib/email/introEmails';
import { getMutuals } from './mutuals';
import type { ConversationIntroContext, IntroInbox, IntroNodeSummary, IntroRequestDTO, IntroStatus } from './types';
import type { CreateIntroInput, IntroActionInput } from '@/lib/schemas/introSchemas';

export class IntroError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'IntroError';
  }
}

// ── enrichment ───────────────────────────────────────────────────────────────

async function summarizeNodes(ids: string[]): Promise<Map<string, IntroNodeSummary>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const nodes = await prisma.node.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true, type: true, subtitle: true, imageUrl: true },
  });
  return new Map(nodes.map((n) => [n.id, {
    id: n.id, name: n.name, type: n.type, subtitle: n.subtitle, imageUrl: n.imageUrl,
  }]));
}

async function resolveContact(nodeId: string): Promise<{ name: string; email: string | null } | null> {
  const person = await prisma.person.findUnique({
    where: { id: nodeId },
    select: { name: true, user: { select: { email: true } } },
  });
  if (!person) return null;
  return { name: person.name, email: person.user?.email ?? null };
}

function toDTO(r: IntroRequest, nodeMap: Map<string, IntroNodeSummary>): IntroRequestDTO {
  return {
    id: r.id,
    communityId: r.communityId,
    requesterNodeId: r.requesterNodeId,
    introducerNodeId: r.introducerNodeId,
    targetNodeId: r.targetNodeId,
    messageToIntroducer: r.messageToIntroducer,
    messageToTarget: r.messageToTarget,
    endorsement: r.endorsement,
    status: r.status as IntroStatus,
    declinedBy: (r.declinedBy as 'introducer' | 'target' | null) ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    requesterNode: nodeMap.get(r.requesterNodeId) ?? null,
    introducerNode: nodeMap.get(r.introducerNodeId) ?? null,
    targetNode: nodeMap.get(r.targetNodeId) ?? null,
  };
}

async function dtoFor(record: IntroRequest): Promise<IntroRequestDTO> {
  const nodeMap = await summarizeNodes([record.requesterNodeId, record.introducerNodeId, record.targetNodeId]);
  return toDTO(record, nodeMap);
}

// ── reads ────────────────────────────────────────────────────────────────────

export async function listIntros(session: SessionPayload): Promise<IntroInbox> {
  const personId = session.personId;
  if (!personId) return { incoming: [], sent: [], received: [] };

  const records = await prisma.introRequest.findMany({
    where: {
      OR: [
        { introducerNodeId: personId },
        { requesterNodeId: personId },
        { targetNodeId: personId, status: { in: ['approved', 'connected'] } },
      ],
    },
    orderBy: { updatedAt: 'desc' },
  });

  const nodeMap = await summarizeNodes(
    records.flatMap((r) => [r.requesterNodeId, r.introducerNodeId, r.targetNodeId]),
  );
  const dtos = records.map((r) => toDTO(r, nodeMap));

  return {
    incoming: dtos.filter((d) => d.introducerNodeId === personId),
    sent: dtos.filter((d) => d.requesterNodeId === personId),
    received: dtos.filter((d) => d.targetNodeId === personId && (d.status === 'approved' || d.status === 'connected')),
  };
}

/** Items awaiting the viewer's action — drives the topbar bell badge. */
export async function pendingCount(session: SessionPayload): Promise<number> {
  const personId = session.personId;
  if (!personId) return 0;
  return prisma.introRequest.count({
    where: {
      OR: [
        { introducerNodeId: personId, status: 'pending' },
        { targetNodeId: personId, status: 'approved' },
      ],
    },
  });
}

/**
 * Provenance for a DM that exists because of an accepted introduction: given the
 * two members of a DM, find the connected intro between their person nodes (either
 * direction) so the thread can show "introduced by …". Returns null when the DM
 * didn't come from an intro (the common case).
 */
export async function getIntroContextForUsers(userIdA: string, userIdB: string): Promise<ConversationIntroContext | null> {
  const persons = await prisma.person.findMany({
    where: { userId: { in: [userIdA, userIdB] } },
    select: { id: true, userId: true },
  });
  if (persons.length < 2) return null;
  const [a, b] = persons;

  const intro = await prisma.introRequest.findFirst({
    where: {
      status: 'connected',
      OR: [
        { requesterNodeId: a.id, targetNodeId: b.id },
        { requesterNodeId: b.id, targetNodeId: a.id },
      ],
    },
    orderBy: { updatedAt: 'desc' },
  });
  if (!intro) return null;

  const nodeMap = await summarizeNodes([intro.introducerNodeId, intro.requesterNodeId]);
  return {
    introId: intro.id,
    introducer: nodeMap.get(intro.introducerNodeId) ?? null,
    requesterNodeId: intro.requesterNodeId,
    requesterName: nodeMap.get(intro.requesterNodeId)?.name ?? null,
    endorsement: intro.endorsement,
    connectedAt: intro.updatedAt.toISOString(),
  };
}

// ── create ───────────────────────────────────────────────────────────────────

export async function createIntro(session: SessionPayload, input: CreateIntroInput): Promise<IntroRequestDTO> {
  const requesterNodeId = session.personId;
  if (!requesterNodeId) {
    throw new IntroError(400, 'Link your profile before requesting an introduction.');
  }
  if (input.targetNodeId === requesterNodeId) {
    throw new IntroError(400, "You can't request an introduction to yourself.");
  }
  if (input.introducerNodeId === requesterNodeId || input.introducerNodeId === input.targetNodeId) {
    throw new IntroError(400, 'Pick a valid introducer.');
  }

  // The introducer must be a real mutual connection — never trust the client.
  const mutuals = await getMutuals(requesterNodeId, input.targetNodeId, input.communityId);
  if (!mutuals.some((m) => m.id === input.introducerNodeId)) {
    throw new IntroError(400, 'That person is not a mutual connection you can ask.');
  }

  // One active request per (requester, introducer, target) — don't let a replay
  // spam the introducer's inbox with duplicate pending/approved rows + emails.
  const active = await prisma.introRequest.findFirst({
    where: {
      requesterNodeId,
      introducerNodeId: input.introducerNodeId,
      targetNodeId: input.targetNodeId,
      status: { in: ['pending', 'approved'] },
    },
    select: { id: true },
  });
  if (active) {
    throw new IntroError(409, 'You already have an active introduction request to this person.');
  }

  const created = await prisma.introRequest.create({
    data: {
      communityId: input.communityId,
      requesterNodeId,
      introducerNodeId: input.introducerNodeId,
      targetNodeId: input.targetNodeId,
      messageToIntroducer: input.messageToIntroducer,
      messageToTarget: input.messageToTarget,
    },
  });

  void notifyRequested(created).catch((err) => logger.error('intro.email.requested.failed', { err }));
  return dtoFor(created);
}

// ── transitions ──────────────────────────────────────────────────────────────

export async function transition(
  session: SessionPayload,
  id: string,
  action: IntroActionInput['action'],
  endorsement?: string,
): Promise<IntroRequestDTO & { conversationId?: string }> {
  const personId = session.personId;
  if (!personId) throw new IntroError(401, 'No linked profile.');

  const intro = await prisma.introRequest.findUnique({ where: { id } });
  if (!intro) throw new IntroError(404, 'Intro request not found.');

  let updated: IntroRequest;
  let conversationId: string | undefined;

  if (action === 'approve') {
    if (intro.introducerNodeId !== personId) throw new IntroError(403, 'Only the introducer can approve this.');
    if (intro.status !== 'pending') throw new IntroError(409, 'This request is no longer pending.');
    if (!endorsement?.trim()) throw new IntroError(400, 'Write a short endorsement to approve.');
    updated = await prisma.introRequest.update({
      where: { id },
      data: { status: 'approved', endorsement: endorsement.trim() },
    });
    void notifyForwarded(updated).catch((err) => logger.error('intro.email.forwarded.failed', { err }));
  } else if (action === 'decline') {
    if (intro.introducerNodeId === personId && intro.status === 'pending') {
      updated = await prisma.introRequest.update({ where: { id }, data: { status: 'declined', declinedBy: 'introducer' } });
    } else if (intro.targetNodeId === personId && intro.status === 'approved') {
      updated = await prisma.introRequest.update({ where: { id }, data: { status: 'declined', declinedBy: 'target' } });
    } else {
      throw new IntroError(403, "You can't decline this request right now.");
    }
  } else {
    // accept — only the recipient, only from 'approved'. The status flip is a
    // conditional updateMany so two concurrent accepts can't both proceed (and
    // thus can't both run connectNodes and create a duplicate link).
    if (intro.targetNodeId !== personId) throw new IntroError(403, 'Only the recipient can accept this.');
    const flipped = await prisma.introRequest.updateMany({
      where: { id, status: 'approved' },
      data: { status: 'connected' },
    });
    if (flipped.count === 0) throw new IntroError(409, 'This introduction is not ready to accept.');
    updated = await prisma.introRequest.findUniqueOrThrow({ where: { id } });
    await connectNodes(updated);
    void notifyConnected(updated).catch((err) => logger.error('intro.email.connected.failed', { err }));
    // Awaited (still best-effort) so the response can point the client at the new DM.
    conversationId = await seedIntroConversation(updated).catch((err) => {
      logger.error('intro.dm.seed.failed', { err });
      return undefined;
    });
  }

  const dto = await dtoFor(updated);
  return conversationId ? { ...dto, conversationId } : dto;
}

// ── side effects ─────────────────────────────────────────────────────────────

/** Create an undirected "introduced" Link between requester and target if absent. */
async function connectNodes(intro: IntroRequest): Promise<void> {
  const existing = await prisma.link.findFirst({
    where: {
      OR: [
        { sourceId: intro.requesterNodeId, targetId: intro.targetNodeId },
        { sourceId: intro.targetNodeId, targetId: intro.requesterNodeId },
      ],
    },
    select: { id: true },
  });
  if (existing) return;
  await prisma.link.create({
    data: {
      sourceId: intro.requesterNodeId,
      targetId: intro.targetNodeId,
      relationship: 'introduced',
      communityId: intro.communityId,
      since: new Date().toISOString().slice(0, 10),
    },
  });
}

/** Best-effort: open a DM between requester & target seeded with the intro message. */
async function seedIntroConversation(intro: IntroRequest): Promise<string | undefined> {
  const [requester, target] = await Promise.all([
    prisma.person.findUnique({ where: { id: intro.requesterNodeId }, select: { userId: true } }),
    prisma.person.findUnique({ where: { id: intro.targetNodeId }, select: { userId: true } }),
  ]);
  const requesterUserId = requester?.userId;
  const targetUserId = target?.userId;
  if (!requesterUserId || !targetUserId || requesterUserId === targetUserId) return undefined;

  const convo = await createDmConversation(requesterUserId, targetUserId);
  await prisma.message.create({
    data: { conversationId: convo.id, senderId: requesterUserId, text: intro.messageToTarget },
  });
  return convo.id;
}

async function notifyRequested(intro: IntroRequest): Promise<void> {
  const [introducer, requester, target] = await Promise.all([
    resolveContact(intro.introducerNodeId),
    resolveContact(intro.requesterNodeId),
    resolveContact(intro.targetNodeId),
  ]);
  if (!introducer?.email) return;
  await sendIntroRequestedEmail({
    to: introducer.email,
    introducerName: introducer.name,
    requesterName: requester?.name ?? 'Someone',
    targetName: target?.name ?? 'someone you both know',
    message: intro.messageToIntroducer,
  });
}

async function notifyForwarded(intro: IntroRequest): Promise<void> {
  const [target, requester, introducer] = await Promise.all([
    resolveContact(intro.targetNodeId),
    resolveContact(intro.requesterNodeId),
    resolveContact(intro.introducerNodeId),
  ]);
  if (!target?.email) return;
  await sendIntroForwardedEmail({
    to: target.email,
    targetName: target.name,
    requesterName: requester?.name ?? 'Someone',
    introducerName: introducer?.name ?? 'A mutual connection',
    endorsement: intro.endorsement ?? '',
    message: intro.messageToTarget,
  });
}

async function notifyConnected(intro: IntroRequest): Promise<void> {
  const [requester, target] = await Promise.all([
    resolveContact(intro.requesterNodeId),
    resolveContact(intro.targetNodeId),
  ]);
  if (requester?.email) {
    await sendIntroConnectedEmail({ to: requester.email, recipientName: requester.name, otherName: target?.name ?? 'your new connection' });
  }
  if (target?.email) {
    await sendIntroConnectedEmail({ to: target.email, recipientName: target.name, otherName: requester?.name ?? 'your new connection' });
  }
}
