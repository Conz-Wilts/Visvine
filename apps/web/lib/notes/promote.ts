// Promotion — how knowledge moves up the tree (blackbird-brain README §"How
// knowledge moves up"). A member SHARES a note from their personal community's
// brain into a community brain. With write access to the destination the copy
// applies immediately (provenance-stamped, audited; the personal original stays
// theirs to keep editing); without it, the promotion is queued as a proposal
// ("move-proposals.jsonl") for a folder admin to approve. One-time copy, not a
// live sync — the shared copy evolves in the community from then on.

import { randomUUID } from 'crypto'
import * as store from './store'
import { SHARED_OWNER_KEY, type Brain } from './store'
import { writeDenial } from './brainService'
import { publishNote } from './publications'
import { personalCommunityId } from '@/lib/onboarding/personalCommunity'
import { logAudit } from './audit'
import { appendJsonl, readJsonl, writeJsonl } from './sidecar'
import { folderIdOfPath } from './shared/placement'
import { principalCanManage } from './shared/permissions'
import { parseFrontmatter, splitFrontmatter, joinFrontmatter } from './shared/markdown'
import { provenanceRef } from './shared/noteLog'
import type { BrainPrincipal, MoveProposalEntry } from './shared/brainTypes'

const FILE = 'move-proposals.jsonl'

function sharedBrain(communityId: string): Brain {
  return { communityId, ownerKey: SHARED_OWNER_KEY }
}

export type PromoteResult =
  | { status: 'applied'; path: string }
  | { status: 'proposed'; proposalId: string }
  | { status: 'denied'; reason: string }

/** Stamp provenance + authorship on the shared copy. */
function promotedContent(content: string, fromRef: string, p: BrainPrincipal): string {
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
  p: BrainPrincipal,
  fromRef: string,
  toPath: string,
  content: string,
): Promise<string> {
  const shared = sharedBrain(p.communityId)
  let dest = toPath
  let n = 1
  // Suffix on collision rather than overwriting someone else's note.
  while (await store.readNoteOrNull(shared, dest)) {
    dest = toPath.replace(/\.md$/i, '') + `-${n++}.md`
  }
  await store.writeNote(shared, dest, content, { id: p.userId, name: p.name, email: p.email || null })
  void logAudit(p.communityId, {
    userId: p.userId,
    name: p.name,
    action: 'promote',
    path: dest,
    detail: `from ${fromRef}`,
  })
  return dest
}

/**
 * Share (promote) a note from the caller's personal community brain into the
 * target community's brain (`p.communityId`). Copies — the personal original
 * stays. Applies directly when the caller can write the destination; otherwise
 * queues a proposal for a folder admin.
 */
export async function promoteNote(
  p: BrainPrincipal,
  personalBrain: Brain,
  fromPath: string,
  toPath: string,
): Promise<PromoteResult> {
  const raw = await store.readNoteOrNull(personalBrain, fromPath)
  if (raw === null) return { status: 'denied', reason: `Note not found: ${fromPath}` }
  const fromRef = provenanceRef(`${personalBrain.communityId}/${fromPath}`)
  const content = promotedContent(raw, fromRef, p)

  const denial = writeDenial(p, sharedBrain(p.communityId), toPath)
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
  await appendJsonl(sharedBrain(p.communityId), FILE, proposal)
  return { status: 'proposed', proposalId: proposal.id }
}

/**
 * Queue a PUBLISH proposal: the caller wants a live-syncing replica at
 * `toPath` but lacks edit access there. Approval creates the publication
 * (lib/notes/publications.ts) instead of a one-time copy.
 */
export async function queuePublishProposal(
  p: BrainPrincipal,
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
  await appendJsonl(sharedBrain(p.communityId), FILE, proposal)
  return proposal
}

/** Proposals the principal may see: their own, plus any folder they manage. */
export async function listProposals(p: BrainPrincipal): Promise<MoveProposalEntry[]> {
  const all = await readJsonl<MoveProposalEntry>(sharedBrain(p.communityId), FILE)
  return all
    .filter((r) => r.proposedBy === p.userId || principalCanManage(p, r.folderId))
    .reverse()
}

/**
 * Approve or deny a pending promotion/publication. Requires manage (full) at
 * the destination folder. Approving a copy writes the proposal's snapshot into
 * the shared folder; approving a PUBLISH proposal creates the live publication
 * from the proposer's personal brain (reading its CURRENT content — the
 * snapshot is only the preview). The personal original is left to its owner —
 * an admin cannot reach into a personal brain.
 */
export async function resolveProposal(
  p: BrainPrincipal,
  proposalId: string,
  approve: boolean,
): Promise<MoveProposalEntry> {
  const all = await readJsonl<MoveProposalEntry>(sharedBrain(p.communityId), FILE)
  const proposal = all.find((r) => r.id === proposalId)
  if (!proposal) throw new Error('Proposal not found')
  if (!principalCanManage(p, proposal.folderId)) {
    throw new Error('Only a folder admin can resolve promotion proposals')
  }
  if (proposal.status !== 'pending') return proposal
  if (approve && proposal.kind === 'publish') {
    const result = await publishNote(
      personalCommunityId(proposal.proposedBy),
      proposal.fromPath,
      p.communityId,
      proposal.toPath,
      { id: proposal.proposedBy, name: proposal.proposerName },
    )
    if (result.status === 'denied') throw new Error(result.reason)
    void logAudit(p.communityId, {
      userId: p.userId,
      name: p.name,
      action: 'publish',
      path: result.publication.targetPath,
      detail: `approved publish proposal from ${proposal.proposerName}`,
    })
  } else if (approve) {
    const shared = sharedBrain(p.communityId)
    let dest = proposal.toPath
    let n = 1
    while (await store.readNoteOrNull(shared, dest)) {
      dest = proposal.toPath.replace(/\.md$/i, '') + `-${n++}.md`
    }
    await store.writeNote(shared, dest, proposal.content, {
      id: proposal.proposedBy,
      name: proposal.proposerName,
    })
    void logAudit(p.communityId, {
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
  await writeJsonl(sharedBrain(p.communityId), FILE, all)
  return proposal
}
