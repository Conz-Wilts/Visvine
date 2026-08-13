// Promotion — how knowledge moves up the tree. A member SHARES a note from their personal space's
// context into a space context. With write access to the destination the copy
// applies immediately (provenance-stamped, audited; the personal original stays
// theirs to keep editing); without it, the promotion is queued as a proposal
// ("move-proposals.jsonl") for a folder admin to approve. One-time copy, not a
// live sync — the shared copy evolves in the space from then on.

import { randomUUID } from 'crypto'
import * as store from './store'
import { SHARED_OWNER_KEY, type Context } from './store'
import { writeDenial } from './contextService'
import { publishNote } from './publications'
import { personalSpaceId } from '@/lib/spaces/personalSpace'
import { logAudit } from './audit'
import { appendJsonl, readJsonl, writeJsonl } from './sidecar'
import { folderIdOfPath } from './shared/placement'
import { principalCanManage } from './shared/permissions'
import { parseFrontmatter, splitFrontmatter, joinFrontmatter } from './shared/markdown'
import { provenanceRef } from './shared/noteLog'
import type { ContextPrincipal, MoveProposalEntry } from './shared/contextTypes'

const FILE = 'move-proposals.jsonl'

function sharedContext(spaceId: string): Context {
  return { spaceId, ownerKey: SHARED_OWNER_KEY }
}

export type PromoteResult =
  | { status: 'applied'; path: string }
  | { status: 'proposed'; proposalId: string }
  | { status: 'denied'; reason: string }

/** Stamp provenance + authorship on the shared copy. */
function promotedContent(content: string, fromRef: string, p: ContextPrincipal): string {
  const fm = parseFrontmatter(content)
  const { body } = splitFrontmatter(content)
  return joinFrontmatter(
    {
      ...fm,
      author: p.name,
      sources: Array.from(
        new Set([
          ...(Array.isArray(fm.sources) ? (fm.sources as unknown[]).map(String) : []),
          fromRef,
        ]),
      ),
    },
    body,
  )
}

async function applyPromotion(
  p: ContextPrincipal,
  fromRef: string,
  toPath: string,
  content: string,
): Promise<string> {
  const shared = sharedContext(p.spaceId)
  let dest = toPath
  let n = 1
  // Suffix on collision rather than overwriting someone else's note.
  while (await store.readNoteOrNull(shared, dest)) {
    dest = toPath.replace(/\.md$/i, '') + `-${n++}.md`
  }
  await store.writeNote(shared, dest, content, { id: p.userId, name: p.name, email: p.email || null })
  void logAudit(p.spaceId, {
    userId: p.userId,
    name: p.name,
    action: 'promote',
    path: dest,
    detail: `from ${fromRef}`,
  })
  return dest
}

/**
 * Share (promote) a note from the caller's personal space context into the
 * target space's context (`p.spaceId`). Copies — the personal original
 * stays. Applies directly when the caller can write the destination; otherwise
 * queues a proposal for a folder admin.
 */
export async function promoteNote(
  p: ContextPrincipal,
  personalContext: Context,
  fromPath: string,
  toPath: string,
): Promise<PromoteResult> {
  const raw = await store.readNoteOrNull(personalContext, fromPath)
  if (raw === null) return { status: 'denied', reason: `Note not found: ${fromPath}` }
  const fromRef = provenanceRef(`${personalContext.spaceId}/${fromPath}`)
  const content = promotedContent(raw, fromRef, p)

  const denial = writeDenial(p, sharedContext(p.spaceId), toPath)
  if (!denial) {
    const path = await applyPromotion(p, fromRef, toPath, content)
    return { status: 'applied', path }
  }

  const proposal: MoveProposalEntry = {
    id: randomUUID(),
    fromPath,
    toPath,
    folderId: folderIdOfPath(toPath),
    content,
    proposedBy: p.userId,
    proposerName: p.name,
    proposedAt: Date.now(),
    status: 'pending',
  }
  await appendJsonl(sharedContext(p.spaceId), FILE, proposal)
  return { status: 'proposed', proposalId: proposal.id }
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
