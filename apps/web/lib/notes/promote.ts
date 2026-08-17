// Publish proposals — how knowledge moves up the tree when the proposer lacks
// write access at the destination. POST /api/notes/publications queues a
// proposal ("move-proposals.jsonl") and a folder admin approves it here, which
// creates the live publication (lib/notes/publications.ts).

import { randomUUID } from 'crypto'
import * as store from './store'
import { SHARED_OWNER_KEY, type Context } from './store'
import { publishNote } from './publications'
import { personalSpaceId } from '@/lib/spaces/personalSpace'
import { logAudit } from './audit'
import { appendJsonl, readJsonl, writeJsonl } from './sidecar'
import { folderIdOfPath } from './shared/placement'
import { principalCanManage } from './shared/permissions'
import type { ContextPrincipal, MoveProposalEntry } from './shared/contextTypes'

const FILE = 'move-proposals.jsonl'

function sharedContext(spaceId: string): Context {
  return { spaceId, ownerKey: SHARED_OWNER_KEY }
}

/**
 * Queue a PUBLISH proposal: the caller wants a live-syncing replica at
 * `toPath` but lacks edit access there. Approval creates the publication
 * (lib/notes/publications.ts) instead of a one-time copy.
 */
export async function queuePublishProposal(
  p: ContextPrincipal,
  fromPath: string,
  toPath: string,
  contentSnapshot: string,
): Promise<MoveProposalEntry> {
  const proposal: MoveProposalEntry = {
    id: randomUUID(),
    fromPath,
    toPath,
    folderId: folderIdOfPath(toPath),
    content: contentSnapshot,
    kind: 'publish',
    proposedBy: p.userId,
    proposerName: p.name,
    proposedAt: Date.now(),
    status: 'pending',
  }
  await appendJsonl(sharedContext(p.spaceId), FILE, proposal)
  return proposal
}

/** Proposals the principal may see: their own, plus any folder they manage. */
export async function listProposals(p: ContextPrincipal): Promise<MoveProposalEntry[]> {
  const all = await readJsonl<MoveProposalEntry>(sharedContext(p.spaceId), FILE)
  return all
    .filter((r) => r.proposedBy === p.userId || principalCanManage(p, r.folderId))
    .reverse()
}

/**
 * Approve or deny a pending promotion/publication. Requires manage (full) at
 * the destination folder. Approving a copy writes the proposal's snapshot into
 * the shared folder; approving a PUBLISH proposal creates the live publication
 * from the proposer's personal context (reading its CURRENT content — the
 * snapshot is only the preview). The personal original is left to its owner —
 * an admin cannot reach into a personal context.
 */
export async function resolveProposal(
  p: ContextPrincipal,
  proposalId: string,
  approve: boolean,
): Promise<MoveProposalEntry> {
  const all = await readJsonl<MoveProposalEntry>(sharedContext(p.spaceId), FILE)
  const proposal = all.find((r) => r.id === proposalId)
  if (!proposal) throw new Error('Proposal not found')
  if (!principalCanManage(p, proposal.folderId)) {
    throw new Error('Only a folder admin can resolve promotion proposals')
  }
  if (proposal.status !== 'pending') return proposal
  if (approve && proposal.kind === 'publish') {
    const result = await publishNote(
      personalSpaceId(proposal.proposedBy),
      proposal.fromPath,
      p.spaceId,
      proposal.toPath,
      { id: proposal.proposedBy, name: proposal.proposerName },
    )
    if (result.status === 'denied') throw new Error(result.reason)
    void logAudit(p.spaceId, {
      userId: p.userId,
      name: p.name,
      action: 'publish',
      path: result.publication.targetPath,
      detail: `approved publish proposal from ${proposal.proposerName}`,
    })
  } else if (approve) {
    const shared = sharedContext(p.spaceId)
    let dest = proposal.toPath
    let n = 1
    while (await store.readNoteOrNull(shared, dest)) {
      dest = proposal.toPath.replace(/\.md$/i, '') + `-${n++}.md`
    }
    await store.writeNote(shared, dest, proposal.content, {
      id: proposal.proposedBy,
      name: proposal.proposerName,
    })
    void logAudit(p.spaceId, {
      userId: p.userId,
      name: p.name,
      action: 'promote',
      path: dest,
      detail: `approved proposal from ${proposal.proposerName}`,
    })
  }
  proposal.status = approve ? 'approved' : 'denied'
  proposal.resolvedBy = p.userId
  proposal.resolvedAt = Date.now()
  await writeJsonl(sharedContext(p.spaceId), FILE, all)
  return proposal
}
