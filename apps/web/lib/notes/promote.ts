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
import { logAudit } from './audit'
import { appendJsonl, readJsonl, writeJsonl } from './sidecar'
import { folderIdOfPath } from './shared/placement'
import { principalIsFolderAdmin } from './shared/permissions'
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

/** Proposals the principal may see: their own, plus any folder they admin. */
export async function listProposals(p: BrainPrincipal): Promise<MoveProposalEntry[]> {
  const all = await readJsonl<MoveProposalEntry>(sharedBrain(p.communityId), FILE)
  return all
    .filter((r) => r.proposedBy === p.userId || principalIsFolderAdmin(p, r.folderId))
    .reverse()
}

/**
 * Approve or deny a pending promotion. Folder-admin only. Approval writes the
 * proposal's snapshot into the shared folder (the personal original is left to
 * its owner — an admin cannot reach into a personal brain).
 */
export async function resolveProposal(
  p: BrainPrincipal,
  proposalId: string,
  approve: boolean,
): Promise<MoveProposalEntry> {
  const all = await readJsonl<MoveProposalEntry>(sharedBrain(p.communityId), FILE)
  const proposal = all.find((r) => r.id === proposalId)
  if (!proposal) throw new Error('Proposal not found')
  if (!principalIsFolderAdmin(p, proposal.folderId)) {
    throw new Error('Only a folder admin can resolve promotion proposals')
  }
  if (proposal.status !== 'pending') return proposal
  proposal.status = approve ? 'approved' : 'denied'
  proposal.resolvedBy = p.userId
  proposal.resolvedAt = Date.now()
  await writeJsonl(sharedBrain(p.communityId), FILE, all)
  if (approve) {
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
  return proposal
}
