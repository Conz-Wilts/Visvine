// Access requests for the context gate, restricted folders, and individual notes
// (table `context_access_requests`, successor of the "join-requests.jsonl"
// sidecar). A member asks for a resource path ('' = the context root, i.e. context
// access); whoever MANAGES that path — full-level grant holders and space
// admins — approves, which writes a grant at EXACTLY that path, or denies.
// Resolved rows are kept as the audit trail behind the console queue.
//
// The pure rules (who may file, who may see, how it reads) live in
// shared/accessRequests.ts so the UI and the API agree.

import prisma from '@/lib/prisma'
import { SHARED_OWNER_KEY, type Context } from './store'
import { readJsonl, writeJsonl } from './sidecar'
import { accessListFor, grantAccess, normalizeResourcePath } from './access'
import { spaceAdminUserIds } from '@/lib/auth'
import { notify } from '@/lib/notifications/service'
import { logger } from '@/lib/logger'
import { logAudit } from './audit'
import type { AccessRequest, ContextPrincipal } from './shared/contextTypes'
import { canRequest, canResolveRequest, requestVisibleTo, sortRequests } from './shared/accessRequests'
import { LEVEL_FULL, LEVEL_VIEW, levelDisplayLabel, levelName } from './shared/authz'

/** The pre-table store — imported once per space, then deleted. */
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

function sharedContext(spaceId: string): Context {
  return { spaceId, ownerKey: SHARED_OWNER_KEY }
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

// Runs at most once per space per process; deleting the sidecar row makes it
// at most once ever (a racing instance just re-imports the same records).
const imported = new Set<string>()

/**
 * Carry any requests filed against the old JSONL sidecar into the table, then
 * drop the sidecar. Same lazy shape as access.ensureAccessSeeded — nothing has
 * to be backfilled ahead of a deploy.
 */
async function ensureRequestsImported(spaceId: string): Promise<void> {
  if (imported.has(spaceId)) return
  imported.add(spaceId)
  const legacy = await readJsonl<LegacyJoinRequest>(sharedContext(spaceId), LEGACY_FILE)
  if (!legacy.length) return
  await prisma.contextAccessRequest.createMany({
    data: legacy
      .filter((r): r is LegacyJoinRequest & { userId: string } => typeof r.userId === 'string')
      .map((r) => ({
        spaceId,
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
  await writeJsonl(sharedContext(spaceId), LEGACY_FILE, [])
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
  await ensureRequestsImported(p.spaceId)
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
  void notifyManagers(p, path, message).catch((err) =>
    logger.warn('access_requests.notify.failed', { err }),
  )
  return toRequest(row)
}

/**
 * Tell everyone who could resolve the request — space admins plus whoever
 * holds Full access at (or above) the path, directly or through an alias — the
 * same people `canResolveRequest` will let act. Best-effort: filing the
 * request never waits on or fails for this.
 */
async function notifyManagers(p: ContextPrincipal, path: string, message?: string): Promise<void> {
  const [admins, entries] = await Promise.all([spaceAdminUserIds(p.spaceId), accessListFor(p.spaceId, path)])
  const full = entries.filter((e) => e.level >= LEVEL_FULL)
  const direct = full.filter((e) => e.subjectType === 'user').map((e) => e.subjectId)
  const aliasIds = full.filter((e) => e.subjectType === 'alias').map((e) => e.subjectId)
  const viaAlias =
    aliasIds.length > 0
      ? (
          await prisma.userAlias.findMany({
            where: { spaceId: p.spaceId, aliasId: { in: aliasIds } },
            select: { userId: true },
          })
        ).map((r) => r.userId)
      : []
  const managers = [...new Set([...admins, ...direct, ...viaAlias])].filter((id) => id !== p.userId)
  if (managers.length === 0) return
  const target = path === '' ? 'the whole context' : path.replace(/\.md$/i, '')
  await notify(managers, {
    spaceId: p.spaceId,
    kind: 'access_request',
    title: `${p.name || p.email} asked for access to ${target}`,
    body: message?.trim() ? message.trim().slice(0, 1000) : null,
    href: '/admin?section=members',
    dedupeKey: `access_request:${p.userId}:${path}`,
  })
}

/**
 * The resource paths the caller currently has OPEN requests for. Feeds the
 * references rail's locked stubs, so a stub whose source note is already
 * requested shows "pending" instead of offering the button again.
 */
export async function pendingRequestPaths(p: ContextPrincipal): Promise<Set<string>> {
  await ensureRequestsImported(p.spaceId)
  const rows = await prisma.contextAccessRequest.findMany({
    where: { spaceId: p.spaceId, userId: p.userId, status: 'pending' },
    select: { resourcePath: true },
  })
  return new Set(rows.map((r) => r.resourcePath))
}

/**
 * Every request the caller may see — their own plus every request for a path
 * they manage (space admins manage everything). One payload serves both the
 * console queue and a folder manager's SharePanel; each filters what it shows.
 */
export async function listVisibleAccessRequests(p: ContextPrincipal): Promise<AccessRequest[]> {
  await ensureRequestsImported(p.spaceId)
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
    throw new Error('Only someone with full access here (or a space admin) can resolve this request')
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
