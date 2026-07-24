// Join requests for the brain gate and restricted folders — stored in the
// shared brain's sidecar ("join-requests.jsonl"). A member requests access to
// a folder path ('' = the brain root, i.e. brain access); whoever MANAGES that
// path (full-level grant holders, community admins) approves — approval writes
// a view-level user grant — or denies. Resolution updates the record in place.

import { randomUUID } from 'crypto'
import { SHARED_OWNER_KEY, type Brain } from './store'
import { readJsonl, writeJsonl, appendJsonl } from './sidecar'
import { grantAccess } from './access'
import { logAudit } from './audit'
import type { BrainPrincipal, JoinRequest } from './shared/brainTypes'
import { principalCanManage } from './shared/permissions'
import { LEVEL_VIEW } from './shared/authz'

const FILE = 'join-requests.jsonl'

function sharedBrain(communityId: string): Brain {
  return { communityId, ownerKey: SHARED_OWNER_KEY }
}

/** File a request to join a folder ('' = brain access). Idempotent per pending request. */
export async function requestJoin(
  p: BrainPrincipal,
  folderId: string,
  message?: string,
): Promise<JoinRequest> {
  const existing = await readJsonl<JoinRequest>(sharedBrain(p.communityId), FILE)
  const pending = existing.find(
    (r) => r.folderId === folderId && r.userId === p.userId && r.status === 'pending',
  )
  if (pending) return pending
  const request: JoinRequest = {
    id: randomUUID(),
    folderId,
    userId: p.userId,
    name: p.name,
    email: p.email || undefined,
    message,
    requestedAt: Date.now(),
    status: 'pending',
  }
  await appendJsonl(sharedBrain(p.communityId), FILE, request)
  return request
}

/** Requests the principal may see: their own, plus all of any path they manage. */
export async function listJoinRequests(p: BrainPrincipal): Promise<JoinRequest[]> {
  const all = await readJsonl<JoinRequest>(sharedBrain(p.communityId), FILE)
  return all
    .filter((r) => r.userId === p.userId || principalCanManage(p, r.folderId))
    .reverse()
}

/** Approve (grant view) or deny a pending request. Requires manage at the path. */
export async function resolveJoinRequest(
  p: BrainPrincipal,
  requestId: string,
  approve: boolean,
): Promise<JoinRequest> {
  const all = await readJsonl<JoinRequest>(sharedBrain(p.communityId), FILE)
  const request = all.find((r) => r.id === requestId)
  if (!request) throw new Error('Join request not found')
  if (!principalCanManage(p, request.folderId)) {
    throw new Error('Only a folder admin can resolve join requests')
  }
  if (request.status !== 'pending') return request
  // Grant BEFORE persisting the resolution: if the grant fails (e.g. the
  // requester left the community), the request stays pending and retryable.
  if (approve) {
    await grantAccess(
      p.communityId,
      {
        subjectType: 'user',
        subjectId: request.userId,
        resourcePath: request.folderId,
        level: LEVEL_VIEW,
      },
      { userId: p.userId, name: p.name },
    )
  }
  request.status = approve ? 'approved' : 'denied'
  request.resolvedBy = p.userId
  request.resolvedAt = Date.now()
  await writeJsonl(sharedBrain(p.communityId), FILE, all)
  await logAudit(p.communityId, {
    userId: p.userId,
    name: p.name,
    action: 'folder',
    path: request.folderId,
    detail: `${approve ? 'approved' : 'denied'} join request from ${request.name}`,
  })
  return request
}
