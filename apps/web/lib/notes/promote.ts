// Publish proposals — how knowledge moves up the tree when the proposer lacks
// write access at the destination. POST /api/notes/publications queues a
// proposal and a space admin approves it here, which creates the live
// publication (lib/notes/publications.ts).
//
// Backed by the `context_move_proposals` table. Resolution is a single
// conditional UPDATE, which is what makes the pending→resolved transition safe
// for two admins to race.

import * as store from './store'
import { SHARED_OWNER_KEY, type Context } from './store'
import prisma from '@/lib/prisma'
import type { ContextMoveProposal } from '@prisma/client'
import { publishNote } from './publications'
import { personalSpaceId } from '@/lib/spaces/personalSpace'
import { logAudit } from './audit'
import { folderIdOfPath } from './shared/placement'
import { principalCanManage } from './shared/permissions'
import type { ContextPrincipal, MoveProposalEntry } from './shared/contextTypes'

function sharedContext(spaceId: string): Context {
  return { spaceId, ownerKey: SHARED_OWNER_KEY }
}

/** Row → the DTO the API and clients already speak. */
function toEntry(row: ContextMoveProposal): MoveProposalEntry {
  return {
    id: row.id,
    fromPath: row.fromPath,
    toPath: row.toPath,
    folderId: row.folderId,
    content: row.content,
    kind: row.kind === 'publish' ? 'publish' : 'copy',
    proposedBy: row.proposedBy,
    proposerName: row.proposerName,
    proposedAt: row.proposedAt.getTime(),
    status: row.status as MoveProposalEntry['status'],
    ...(row.resolvedBy === null ? {} : { resolvedBy: row.resolvedBy }),
    ...(row.resolvedAt === null ? {} : { resolvedAt: row.resolvedAt.getTime() }),
  }
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
  const row = await prisma.contextMoveProposal.create({
    data: {
      spaceId: p.spaceId,
      fromPath,
      toPath,
      folderId: folderIdOfPath(toPath),
      content: contentSnapshot,
      kind: 'publish',
      proposedBy: p.userId,
      proposerName: p.name,
    },
  })
  return toEntry(row)
}

/** Proposals the principal may see: their own, plus any folder they manage. */
export async function listProposals(p: ContextPrincipal): Promise<MoveProposalEntry[]> {
  // Newest first. Space admins see the whole queue; everyone else sees only
  // what they proposed themselves.
  const rows = await prisma.contextMoveProposal.findMany({
    where: principalCanManage(p) ? { spaceId: p.spaceId } : { spaceId: p.spaceId, proposedBy: p.userId },
    orderBy: { proposedAt: 'desc' },
  })
  return rows.map(toEntry)
}

/**
 * Approve or deny a pending promotion/publication. Space admins only — letting
 * someone else's note into the shared context is an administrative call, not
 * something an edit grant on the destination confers. Approving a copy writes
 * the proposal's snapshot into
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
  const existing = await prisma.contextMoveProposal.findFirst({
    where: { id: proposalId, spaceId: p.spaceId },
  })
  if (!existing) throw new Error('Proposal not found')
  if (!principalCanManage(p)) {
    throw new Error('Only a space admin can resolve promotion proposals')
  }
  if (existing.status !== 'pending') return toEntry(existing)

  // CLAIM FIRST, then act. Two admins can hit this at the same moment, and the
  // side effect below (publishing, or writing a note into the shared context)
  // must not happen twice. The conditional update is the mutex: exactly one
  // caller moves the row off 'pending', and the loser returns what actually
  // happened rather than doing it again.
  const status = approve ? 'approved' : 'denied'
  const claimed = await prisma.contextMoveProposal.updateMany({
    where: { id: proposalId, spaceId: p.spaceId, status: 'pending' },
    data: { status, resolvedBy: p.userId, resolvedAt: new Date() },
  })
  if (claimed.count === 0) {
    const current = await prisma.contextMoveProposal.findFirst({
      where: { id: proposalId, spaceId: p.spaceId },
    })
    if (!current) throw new Error('Proposal not found')
    return toEntry(current)
  }

  if (approve) {
    try {
      if (existing.kind === 'publish') {
        const result = await publishNote(
          personalSpaceId(existing.proposedBy),
          existing.fromPath,
          p.spaceId,
          existing.toPath,
          { id: existing.proposedBy, name: existing.proposerName },
        )
        if (result.status === 'denied') throw new Error(result.reason)
        void logAudit(p.spaceId, {
          userId: p.userId,
          name: p.name,
          action: 'publish',
          path: result.publication.targetPath,
          detail: `approved publish proposal from ${existing.proposerName}`,
        })
      } else {
        const shared = sharedContext(p.spaceId)
        let dest = existing.toPath
        let n = 1
        while (await store.readNoteOrNull(shared, dest)) {
          dest = existing.toPath.replace(/\.md$/i, '') + `-${n++}.md`
        }
        await store.writeNote(shared, dest, existing.content, {
          id: existing.proposedBy,
          name: existing.proposerName,
        })
        void logAudit(p.spaceId, {
          userId: p.userId,
          name: p.name,
          action: 'promote',
          path: dest,
          detail: `approved proposal from ${existing.proposerName}`,
        })
      }
    } catch (err) {
      // The approval did not take effect, so it must not read as approved —
      // release the claim and let the admin (or the other one) try again.
      await prisma.contextMoveProposal.updateMany({
        where: { id: proposalId, spaceId: p.spaceId, status },
        data: { status: 'pending', resolvedBy: null, resolvedAt: null },
      })
      throw err
    }
  }

  return toEntry({
    ...existing,
    status,
    resolvedBy: p.userId,
    resolvedAt: new Date(),
  })
}
