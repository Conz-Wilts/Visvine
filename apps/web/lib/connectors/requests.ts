// A member's ask that the space connect a service it does not have yet
// (table `connector_requests`).
//
// The Directory's Connectors table offers every recipe in the catalogue,
// but adding one is an admin's act — the note it writes decides what agents
// reach and whose credentials they spend. So a member asks, and the request
// surfaces in the console's Connectors section, where Add runs the recipe and
// Dismiss closes it. Access to a connector the space ALREADY has is a
// different ask — a ContextAccessRequest on its note — and is answered where
// every other access request is, on Members.

import prisma from '@/lib/prisma'
import { logAudit } from '@/lib/notes/audit'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import { principalCanManage } from '@/lib/notes/shared/permissions'
import { CONNECTOR_CATALOG } from './catalog'

type ConnectorRequestStatus = 'pending' | 'added' | 'dismissed'

export interface ConnectorRequest {
  id: string
  /** The catalog entry asked for (lib/connectors/catalog.ts). */
  recipe: string
  userId: string
  message: string | null
  status: ConnectorRequestStatus
  requestedAt: number
  resolvedBy: string | null
  resolvedAt: number | null
  /** The note Add wrote, once it has. */
  connectorName: string | null
  // Display snapshots for the console queue (identity is userId).
  requesterName?: string
  requesterEmail?: string
  requesterImage?: string
}

type Row = {
  id: string
  recipe: string
  userId: string
  message: string | null
  status: string
  createdAt: Date
  resolvedBy: string | null
  resolvedAt: Date | null
  connectorName: string | null
}

function toRequest(row: Row): ConnectorRequest {
  return {
    id: row.id,
    recipe: row.recipe,
    userId: row.userId,
    message: row.message,
    status: row.status === 'added' || row.status === 'dismissed' ? row.status : 'pending',
    requestedAt: row.createdAt.getTime(),
    resolvedBy: row.resolvedBy,
    resolvedAt: row.resolvedAt?.getTime() ?? null,
    connectorName: row.connectorName,
  }
}

async function hydrate(requests: ConnectorRequest[]): Promise<ConnectorRequest[]> {
  const ids = [...new Set(requests.map((r) => r.userId))]
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
    }
  })
}

/** Pending first, then newest first — the order a reviewer works in. */
function sortConnectorRequests(requests: ConnectorRequest[]): ConnectorRequest[] {
  return [...requests].sort((a, b) => {
    if (a.status !== b.status) {
      if (a.status === 'pending') return -1
      if (b.status === 'pending') return 1
    }
    return b.requestedAt - a.requestedAt
  })
}

/**
 * File a request for `recipe`. Idempotent: an open request from the same
 * person for the same service is returned untouched rather than duplicated.
 * The recipe must be one the catalogue has — a request names a row on the
 * list the admin will see, never free text.
 */
export async function requestConnector(
  p: ContextPrincipal,
  recipe: string,
  message?: string,
): Promise<ConnectorRequest> {
  const id = recipe.trim().toLowerCase()
  if (!CONNECTOR_CATALOG.some((e) => e.id === id)) throw new Error('That service is not in the catalogue')
  const open = await prisma.connectorRequest.findFirst({
    where: { spaceId: p.spaceId, userId: p.userId, recipe: id, status: 'pending' },
  })
  if (open) return toRequest(open)
  const row = await prisma.connectorRequest.create({
    data: {
      spaceId: p.spaceId,
      userId: p.userId,
      recipe: id,
      message: message?.trim() ? message.trim().slice(0, 1000) : null,
    },
  })
  return toRequest(row)
}

/**
 * Every request the caller may see — their own, plus (for space admins, the
 * reviewers) all of them. One payload serves the console queue and the
 * member's own "Requested" chips; each filters what it shows.
 */
export async function listConnectorRequests(p: ContextPrincipal): Promise<ConnectorRequest[]> {
  const rows = await prisma.connectorRequest.findMany({
    where: principalCanManage(p) ? { spaceId: p.spaceId } : { spaceId: p.spaceId, userId: p.userId },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  return hydrate(sortConnectorRequests(rows.map(toRequest)))
}

/**
 * Close a pending request: `added` names the connector note the admin wrote
 * for it, `dismissed` closes it with nothing written. Space admins only.
 */
export async function resolveConnectorRequest(
  p: ContextPrincipal,
  requestId: string,
  outcome: 'added' | 'dismissed',
  connectorName?: string,
): Promise<ConnectorRequest> {
  if (!principalCanManage(p)) throw new Error('Only a space admin can resolve this request')
  const row = await prisma.connectorRequest.findFirst({ where: { id: requestId, spaceId: p.spaceId } })
  if (!row) throw new Error('Connector request not found')
  if (row.status !== 'pending') return toRequest(row)
  const updated = await prisma.connectorRequest.update({
    where: { id: row.id },
    data: {
      status: outcome,
      resolvedBy: p.userId,
      resolvedAt: new Date(),
      connectorName: outcome === 'added' ? (connectorName ?? null) : null,
    },
  })
  await logAudit(p.spaceId, {
    userId: p.userId,
    name: p.name,
    action: 'connector',
    path: connectorName ? `connectors/${connectorName}.md` : 'connectors/',
    detail:
      outcome === 'added'
        ? `added ${row.recipe} for a member who asked for it`
        : `dismissed a request to connect ${row.recipe}`,
  })
  return toRequest(updated)
}
