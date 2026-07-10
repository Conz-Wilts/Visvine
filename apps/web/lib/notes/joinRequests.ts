// Join requests for private folders — the port of blackbird-brain's
// src/server/joinRequests.ts, stored in the shared brain's sidecar
// ("join-requests.jsonl"). A member requests access; a folder admin approves
// (granting read) or denies. Resolution updates the record in place.

import { randomUUID } from 'crypto'
import { SHARED_OWNER_KEY, type Brain } from './store'
import { readJsonl, writeJsonl, appendJsonl } from './sidecar'
import { setMemberLevel } from './registry'
import { logAudit } from './audit'
import type { BrainPrincipal, JoinRequest } from './shared/brainTypes'
import { folderById, principalIsFolderAdmin } from './shared/permissions'

const FILE = 'join-requests.jsonl'

function sharedBrain(communityId: string): Brain {
  return { communityId, ownerKey: SHARED_OWNER_KEY }
}

/** File a request to join a private folder (idempotent per pending request). */
export async function requestJoin(
  p: BrainPrincipal,
  folderId: string,
  message?: string,
): Promise<JoinRequest> {
  const folder = folderById(p.folders, folderId)
  if (!folder) throw new Error(`Unknown folder: ${folderId}`)
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

/** Requests the principal may see: their own, plus all of any folder they admin. */
export async function listJoinRequests(p: BrainPrincipal): Promise<JoinRequest[]> {
  const all = await readJsonl<JoinRequest>(sharedBrain(p.communityId), FILE)
  return all
    .filter((r) => r.userId === p.userId || principalIsFolderAdmin(p, r.folderId))
    .reverse()
}

/** Approve (grant read) or deny a pending request. Folder-admin only. */
export async function resolveJoinRequest(
  p: BrainPrincipal,
  requestId: string,
  approve: boolean,
): Promise<JoinRequest> {
  const all = await readJsonl<JoinRequest>(sharedBrain(p.communityId), FILE)
  const request = all.find((r) => r.id === requestId)
  if (!request) throw new Error('Join request not found')
  if (!principalIsFolderAdmin(p, request.folderId)) {
    throw new Error('Only a folder admin can resolve join requests')
  }
  if (request.status !== 'pending') return request
  request.status = approve ? 'approved' : 'denied'
  request.resolvedBy = p.userId
  request.resolvedAt = Date.now()
  await writeJsonl(sharedBrain(p.communityId), FILE, all)
  if (approve) {
    await setMemberLevel(
      p.communityId,
      request.folderId,
      { userId: request.userId, name: request.name, email: request.email },
      'read',
      p.userId,
    )
  }
  await logAudit(p.communityId, {
    userId: p.userId,
    name: p.name,
    action: 'folder',
    path: request.folderId,
    detail: `${approve ? 'approved' : 'denied'} join request from ${request.name}`,
  })
  return request
}
