// Access requests for the context gate, restricted folders, and individual notes
// (table `context_access_requests`). A member asks for a resource path ('' = the context root, i.e. context
// access); whoever MANAGES that path — full-level grant holders and space
// admins — approves, which writes a grant at EXACTLY that path, or denies.
// Resolved rows are kept as the audit trail behind the console queue.
//
// The pure rules (who may file, who may see, how it reads) live in
// shared/accessRequests.ts so the UI and the API agree.

import prisma from '@/lib/prisma'
import { grantAccess, normalizeResourcePath } from './access'
import { logAudit } from './audit'
import type { AccessRequest, ContextPrincipal } from './shared/contextTypes'
import { canRequest, canResolveRequest, requestVisibleTo, sortRequests } from './shared/accessRequests'
import { LEVEL_VIEW, levelDisplayLabel, levelName } from './shared/authz'

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
 * File a request for `resourcePath` ('' = context access). Idempotent: an open
 * request for the same path is returned untouched rather than duplicated.
 */
export async function createAccessRequest(
  p: ContextPrincipal,
  resourcePath: string,
  message?: string,
): Promise<AccessRequest> {
  const path = normalizeResourcePath(resourcePath)
  if (!canRequest(p, path)) throw new Error('You already have access here')
  const open = await prisma.contextAccessRequest.findFirst({
    where: { spaceId: p.spaceId, userId: p.userId, resourcePath: path, status: 'pending' },
  })
  if (open) return toRequest(open)
  const row = await prisma.contextAccessRequest.create({
    data: {
      spaceId: p.spaceId,
      userId: p.userId,
      resourcePath: path,
      level: LEVEL_VIEW,
      message: message?.trim() ? message.trim().slice(0, 1000) : null,
    },
  })
  return toRequest(row)
}

/**
 * The resource paths the caller currently has OPEN requests for. Feeds the
 * references rail's locked stubs, so a stub whose source note is already
 * requested shows "pending" instead of offering the button again.
 */
export async function pendingRequestPaths(p: ContextPrincipal): Promise<Set<string>> {
  const rows = await prisma.contextAccessRequest.findMany({
    where: { spaceId: p.spaceId, userId: p.userId, status: 'pending' },
    select: { resourcePath: true },
  })
  return new Set(rows.map((r) => r.resourcePath))
}

/**
 * Every request the caller may see — their own, plus (for space admins, the
 * reviewers) all of them. One payload serves both the console queue and an
 * admin's SharePanel; each filters what it shows.
 */
export async function listVisibleAccessRequests(p: ContextPrincipal): Promise<AccessRequest[]> {
  const rows = await prisma.contextAccessRequest.findMany({
    where: { spaceId: p.spaceId },
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
  p: ContextPrincipal,
  requestId: string,
  approve: boolean,
  level?: number,
): Promise<AccessRequest> {
  const row = await prisma.contextAccessRequest.findFirst({
    where: { id: requestId, spaceId: p.spaceId },
  })
  if (!row) throw new Error('Access request not found')
  const request = toRequest(row)
  if (!canResolveRequest(p, request)) {
    throw new Error('Only a space admin can resolve this request')
  }
  if (request.status !== 'pending') return request
  const grantLevel = level ?? request.level
  // Grant BEFORE persisting the resolution: if the grant fails (e.g. the
  // requester left the space), the request stays pending and retryable.
  if (approve) {
    await grantAccess(
      p.spaceId,
      {
        subjectType: 'user',
        subjectId: request.userId,
        resourcePath: request.resourcePath,
        level: grantLevel,
      },
      { userId: p.userId, name: p.name },
    )
  }
  const updated = await prisma.contextAccessRequest.update({
    where: { id: request.id },
    data: {
      status: approve ? 'approved' : 'denied',
      resolvedBy: p.userId,
      resolvedAt: new Date(),
      grantedLevel: approve ? grantLevel : null,
    },
  })
  await logAudit(p.spaceId, {
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
