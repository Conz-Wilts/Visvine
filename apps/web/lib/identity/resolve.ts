/**
 * Cross-space identity resolution — the DB layer over the pure matcher.
 *
 * resolveIdentity() is the single entry point every node-creation path should use:
 * it blocks candidate identities out of Postgres, runs the pure tiered matcher
 * (./match.ts), honours human anti-matches, and either attaches the node to an
 * existing canonical Identity or mints a new one — always leaving an audit trail in
 * `identity_resolutions`. See docs / the plan for the model rationale.
 */

import prisma from '../prisma';
import { Prisma } from '@prisma/client';
import { logger } from '../logger';
import {
  toSignals,
  decideMatch,
  type ResolveInput,
  type IdentitySignals,
  type Decision,
} from './match';
import { normalizeCompany, normalizeToken } from './normalize';

export type { ResolveInput } from './match';

export interface ResolveResult {
  identityId: string;
  created: boolean;
  decision: Decision;
  confidence: number;
  reason: string;
  suggestions: Array<{ identityId: string; canonicalName: string; confidence: number; reason: string }>;
}

interface IdentityRow {
  id: string;
  kind: string;
  canonicalName: string;
  nameKey: string;
  email: string | null;
  linkedinHandle: string | null;
  websiteDomain: string | null;
  imageUrl: string | null;
  metadata: unknown;
}

const IDENTITY_SELECT = {
  id: true,
  kind: true,
  canonicalName: true,
  nameKey: true,
  email: true,
  linkedinHandle: true,
  websiteDomain: true,
  imageUrl: true,
  metadata: true,
} as const;

function rowToSignals(row: IdentityRow): IdentitySignals {
  const meta = (row.metadata as Record<string, unknown>) ?? {};
  return {
    kind: row.kind === 'organization' ? 'organization' : 'person',
    nameKey: row.nameKey,
    email: row.email,
    linkedinHandle: row.linkedinHandle,
    websiteDomain: row.websiteDomain,
    company: normalizeCompany((meta.company as string) ?? null),
    location: normalizeToken((meta.location as string) ?? null),
  };
}

function buildMetadata(input: ResolveInput): Prisma.InputJsonValue {
  const m: Record<string, unknown> = {};
  if (input.company) m.company = input.company;
  if (input.location) m.location = input.location;
  return m as Prisma.InputJsonValue;
}

/** When auto-attaching, opportunistically fill identity fields that were unknown. */
async function backfillIdentityFields(identityId: string, signals: IdentitySignals, input: ResolveInput): Promise<void> {
  const existing = await prisma.identity.findUnique({
    where: { id: identityId },
    select: { email: true, linkedinHandle: true, websiteDomain: true, imageUrl: true, metadata: true },
  });
  if (!existing) return;

  const data: Prisma.IdentityUpdateInput = {};
  if (!existing.email && signals.email) data.email = signals.email;
  if (!existing.linkedinHandle && signals.linkedinHandle) data.linkedinHandle = signals.linkedinHandle;
  if (!existing.websiteDomain && signals.websiteDomain) data.websiteDomain = signals.websiteDomain;

  const meta = { ...((existing.metadata as Record<string, unknown>) ?? {}) };
  let metaChanged = false;
  if (!meta.company && input.company) {
    meta.company = input.company;
    metaChanged = true;
  }
  if (!meta.location && input.location) {
    meta.location = input.location;
    metaChanged = true;
  }
  if (metaChanged) data.metadata = meta as Prisma.InputJsonValue;

  if (Object.keys(data).length > 0) {
    await prisma.identity.update({ where: { id: identityId }, data });
  }
}

/**
 * Resolve which canonical Identity a (to-be-created or existing) node represents.
 * Writes the assignment + any suggestion rows to the audit table and returns the
 * chosen identity id. `nodeId` need not exist yet — audit rows reference it loosely.
 */
async function resolveIdentity(
  nodeId: string,
  input: ResolveInput,
  opts: { actorUserId?: string | null } = {},
): Promise<ResolveResult> {
  const actorUserId = opts.actorUserId ?? null;
  const signals = toSignals(input);

  // 1. Blocking — same kind, sharing any strong id or the name key. Index-backed.
  const orFilters: Prisma.IdentityWhereInput[] = [];
  if (signals.email) orFilters.push({ email: signals.email });
  if (signals.linkedinHandle) orFilters.push({ linkedinHandle: signals.linkedinHandle });
  if (signals.websiteDomain) orFilters.push({ websiteDomain: signals.websiteDomain });
  if (signals.nameKey) orFilters.push({ nameKey: signals.nameKey });

  const candidates: IdentityRow[] = orFilters.length
    ? await prisma.identity.findMany({ where: { kind: input.kind, OR: orFilters }, select: IDENTITY_SELECT, take: 50 })
    : [];

  // 2. Anti-matches a human already recorded for this node.
  const rejected = await prisma.identityResolution.findMany({
    where: { nodeId, decision: { in: ['rejected', 'split'] } },
    select: { identityId: true },
  });
  const rejectedIds = new Set(rejected.map((r) => r.identityId).filter((x): x is string => !!x));

  // 3. Decide (pure).
  const result = decideMatch(
    signals,
    candidates.map((c) => ({ identityId: c.id, canonicalName: c.canonicalName, signals: rowToSignals(c) })),
    rejectedIds,
  );

  // 4. Attach to the matched identity, or mint a fresh one.
  let identityId: string;
  let created = false;
  if ((result.decision === 'auto_strong' || result.decision === 'auto_name_company') && result.identityId) {
    identityId = result.identityId;
    await backfillIdentityFields(identityId, signals, input);
  } else {
    const fresh = await prisma.identity.create({
      data: {
        kind: input.kind,
        canonicalName: input.name,
        nameKey: signals.nameKey,
        email: signals.email,
        linkedinHandle: signals.linkedinHandle,
        websiteDomain: signals.websiteDomain,
        metadata: buildMetadata(input),
      },
      select: { id: true },
    });
    identityId = fresh.id;
    created = true;
  }

  // 5. Audit: one assignment row (a fresh identity is logged as 'created' even when
  //    suggestions exist), plus a 'suggested' row per possible match for the queue.
  const assignmentDecision: Decision = result.decision === 'suggested' ? 'created' : result.decision;
  const auditRows: Prisma.IdentityResolutionCreateManyInput[] = [
    { nodeId, identityId, decision: assignmentDecision, confidence: result.confidence, reason: result.reason, actorUserId },
  ];
  for (const s of result.suggestions) {
    auditRows.push({ nodeId, identityId: s.identityId, decision: 'suggested', confidence: s.score.confidence, reason: s.score.reason });
  }
  await prisma.identityResolution.createMany({ data: auditRows });

  return {
    identityId,
    created,
    decision: result.decision,
    confidence: result.confidence,
    reason: result.reason,
    suggestions: result.suggestions.map((s) => ({
      identityId: s.identityId,
      canonicalName: s.canonicalName,
      confidence: s.score.confidence,
      reason: s.score.reason,
    })),
  };
}

/**
 * Honour an explicit human choice to attach a node to an existing identity (e.g. the
 * user picked it from the quick-add finder). Records a 'confirmed' decision and
 * clears any prior anti-match between this node and identity.
 */
export async function confirmIdentity(
  nodeId: string,
  identityId: string,
  opts: { actorUserId?: string | null; reason?: string } = {},
): Promise<boolean> {
  const identity = await prisma.identity.findUnique({ where: { id: identityId }, select: { id: true } });
  if (!identity) return false;
  await prisma.identityResolution.create({
    data: {
      nodeId,
      identityId,
      decision: 'confirmed',
      confidence: 1,
      reason: opts.reason ?? 'user confirmed',
      actorUserId: opts.actorUserId ?? null,
    },
  });
  return true;
}


/** Best-effort resolve that never throws into a node-creation path. */
export async function tryResolveIdentity(
  nodeId: string,
  input: ResolveInput,
  opts: { actorUserId?: string | null } = {},
): Promise<ResolveResult | null> {
  try {
    return await resolveIdentity(nodeId, input, opts);
  } catch (err) {
    logger.error('identity.resolve.failed', { err, nodeId });
    return null;
  }
}
