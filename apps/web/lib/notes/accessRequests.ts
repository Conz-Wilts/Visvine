// Access requests for the brain gate, restricted folders, and individual notes
// (table `brain_access_requests`, successor of the "join-requests.jsonl"
// sidecar). A member asks for a resource path ('' = the brain root, i.e. brain
// access); whoever MANAGES that path — full-level grant holders and community
// admins — approves, which writes a grant at EXACTLY that path, or denies.
// Resolved rows are kept as the audit trail behind the console queue.
//
// The pure rules (who may file, who may see, how it reads) live in
// shared/accessRequests.ts so the UI and the API agree.

import prisma from '@/lib/prisma'
import { SHARED_OWNER_KEY, type Brain } from './store'
import { readJsonl, writeJsonl } from './sidecar'
import { grantAccess, normalizeResourcePath } from './access'
import { logAudit } from './audit'
import type { AccessRequest, BrainPrincipal } from './shared/brainTypes'
import { canRequest, canResolveRequest, requestVisibleTo, sortRequests } from './shared/accessRequests'
import { LEVEL_VIEW, levelDisplayLabel, levelName } from './shared/authz'

/** The pre-table store — imported once per community, then deleted. */
const LEGACY_FILE = 'join-requests.jsonl'

interface LegacyJoinRequest {
  id?: string
  folderId?: string
  userId?: string
  message?: string
  requestedAt?: number
  status?: string
  resolvedBy?: string
  resolvedAt?: number
}

type RequestRow = {
  id: string
  userId: string
  resourcePath: string
  level: number
  message: string | null
  status: string
  createdAt: Date
  resolvedBy: string | null
  resolvedAt: Date | null
  grantedLevel: number | null
}

function sharedBrain(communityId: string): Brain {
  return { communityId, ownerKey: SHARED_OWNER_KEY }
}

function toRequest(row: RequestRow): AccessRequest {
  return {
    id: row.id,
    resourcePath: row.resourcePath,
    userId: row.userId,
    level: row.level,
    message: row.message ?? undefined,
    requestedAt: row.createdAt.getTime(),
    status: row.status === 'approved' || row.status === 'denied' ? row.status : 'pending',
    resolvedBy: row.resolvedBy ?? undefined,
    resolvedAt: row.resolvedAt?.getTime(),
    grantedLevel: row.grantedLevel ?? undefined,
  }
}

// Runs at most once per community per process; deleting the sidecar row makes it
// at most once ever (a racing instance just re-imports the same records).
const imported = new Set<string>()

/**
 * Carry any requests filed against the old JSONL sidecar into the table, then
 * drop the sidecar. Same lazy shape as access.ensureAccessSeeded — nothing has
 * to be backfilled ahead of a deploy.
 */
async function ensureRequestsImported(communityId: string): Promise<void> {
  if (imported.has(communityId)) return
  imported.add(communityId)
  const legacy = await readJsonl<LegacyJoinRequest>(sharedBrain(communityId), LEGACY_FILE)
  if (!legacy.length) return
  await prisma.brainAccessRequest.createMany({
    data: legacy
      .filter((r): r is LegacyJoinRequest & { userId: string } => typeof r.userId === 'string')
      .map((r) => ({
        communityId,
        userId: r.userId,
        resourcePath: typeof r.folderId === 'string' ? r.folderId : '',
        level: LEVEL_VIEW,
        message: r.message ?? null,
        status: r.status === 'approved' || r.status === 'denied' ? r.status : 'pending',
        createdAt: new Date(r.requestedAt ?? Date.now()),
        resolvedBy: r.resolvedBy ?? null,
        resolvedAt: r.resolvedAt ? new Date(r.resolvedAt) : null,
      })),
  })
  // Empty the sidecar so a second process can't import the same records again.
  await writeJsonl(sharedBrain(communityId), LEGACY_FILE, [])
}

/** Attach requester/resolver display snapshots for the review queue. */
async function hydrate(requests: AccessRequest[]): Promise<AccessRequest[]> {
  const ids = [...new Set(requests.flatMap((r) => [r.userId, r.resolvedBy ?? '']).filter(Boolean))]
  if (!ids.length) return requests
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, email: true, image: true },
  })
  const byId = new Map(users.map((u) => [u.id, u]))
  return requests.map((r) => {
    const user = byId.get(r.userId)
    return {
      ...r,
      requesterName: user?.name ?? 'Former member',
      requesterEmail: user?.email ?? undefined,
      requesterImage: user?.image ?? undefined,
      resolvedByName: r.resolvedBy ? (byId.get(r.resolvedBy)?.name ?? undefined) : undefined,
    }
  })
}

/**
 * File a request for `resourcePath` ('' = brain access). Idempotent: an open
 * request for the same path is returned untouched rather than duplicated.
 */
export async function createAccessRequest(
  p: BrainPrincipal,
  resourcePath: string,
  message?: string,
): Promise<AccessRequest> {
  const path = normalizeResourcePath(resourcePath)
  if (!canRequest(p, path)) throw new Error('You already have access here')
  await ensureRequestsImported(p.communityId)
  const open = await prisma.brainAccessRequest.findFirst({
    where: { communityId: p.communityId, userId: p.userId, resourcePath: path, status: 'pending' },
  })
  if (open) return toRequest(open)
  const row = await prisma.brainAccessRequest.create({
    data: {
      communityId: p.communityId,
      userId: p.userId,
      resourcePath: path,
      level: LEVEL_VIEW,
      message: message?.trim() ? message.trim().slice(0, 1000) : null,
    },
  })
  return toRequest(row)
}

/**
 * Every request the caller may see — their own plus every request for a path
 * they manage (community admins manage everything). One payload serves both the
 * console queue and a folder manager's SharePanel; each filters what it shows.
 */
export async function listVisibleAccessRequests(p: BrainPrincipal): Promise<AccessRequest[]> {
  await ensureRequestsImported(p.communityId)
  const rows = await prisma.brainAccessRequest.findMany({
    where: { communityId: p.communityId },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  const visible = rows.map(toRequest).filter((r) => requestVisibleTo(p, r))
  return hydrate(sortRequests(visible))
}

/**
 * Approve (granting `level`, defaulting to what was asked for) or deny a pending
 * request. Requires manage standing at the requested path.
 */
export async function resolveAccessRequest(
  p: BrainPrincipal,
  requestId: string,
  approve: boolean,
  level?: number,
): Promise<AccessRequest> {
  const row = await prisma.brainAccessRequest.findFirst({
    where: { id: requestId, communityId: p.communityId },
  })
  if (!row) throw new Error('Access request not found')
  const request = toRequest(row)
  if (!canResolveRequest(p, request)) {
    throw new Error('Only someone with full access here (or a community admin) can resolve this request')
  }
  if (request.status !== 'pending') return request
  const grantLevel = level ?? request.level
  // Grant BEFORE persisting the resolution: if the grant fails (e.g. the
  // requester left the community), the request stays pending and retryable.
  if (approve) {
    await grantAccess(
      p.communityId,
      {
        subjectType: 'user',
        subjectId: request.userId,
        resourcePath: request.resourcePath,
        level: grantLevel,
      },
      { userId: p.userId, name: p.name },
    )
  }
  const updated = await prisma.brainAccessRequest.update({
    where: { id: request.id },
    data: {
      status: approve ? 'approved' : 'denied',
      resolvedBy: p.userId,
      resolvedAt: new Date(),
      grantedLevel: approve ? grantLevel : null,
    },
  })
  await logAudit(p.communityId, {
    userId: p.userId,
    name: p.name,
    action: 'grant',
    path: request.resourcePath,
    detail: approve
      ? `approved access request — granted ${levelDisplayLabel(levelName(grantLevel))}`
      : 'denied access request',
  })
  const [hydrated] = await hydrate([toRequest(updated)])
  return hydrated
}
