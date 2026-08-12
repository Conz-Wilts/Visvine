import prisma from '@/lib/prisma'
import { ApiError } from '@/lib/api/route'
import { assertMembersCanLeave } from '@/lib/notes/aliases'
import { findMemberNode } from '@/lib/identity/connection'
import { logger } from '@/lib/logger'

/**
 * Permanent account deletion, run by the account holder from Settings → Account.
 *
 * Deleting the `User` row alone is not enough, and that is the whole reason this
 * service exists. Half of what belongs to a person is keyed by a plain scalar
 * rather than a foreign key — `owner_key` on the personal-brain tables,
 * `user_id` on `user_aliases`, `subject_id` on `brain_grants` — so Postgres
 * cascades cannot see it, and `Person.userId` is a nullable FK that would be
 * SET NULL, leaving the profile itself behind with nobody attached. Signing up
 * again with the same email would then land next to that orphan.
 *
 * What goes:
 *  - the profile (`Person`) and the cross-community `Identity` it was claimed by
 *  - the member node representing them in every community directory, and with it
 *    (via cascade) their links and column values there
 *  - every personal brain: notes, folders, files, embeddings, sources, chunks
 *  - brain grants, aliases held, and outstanding access requests
 *  - the `User` row, which cascades memberships, messages, posts, reactions,
 *    stars, private columns, and the conversations they created
 *
 * What stays, deliberately: notes other people wrote in a community's SHARED
 * brain, even when the subject is the departing member — that text is the
 * community's, not theirs, and index notes point at it. The `AuditLog` row this
 * writes stays too; `actorId` is a scalar, so the trail survives the account.
 *
 * Refused when they are the last person who can manage a community — the same
 * invariant that blocks an admin from removing that member (`assertOwnerSurvives`).
 * Ownership has to be handed over first.
 */

export interface DeleteAccountResult {
  /** Communities they were a member of. */
  communities: number
  /** Directory nodes removed (one per community that had one). */
  nodes: number
  /** Personal-brain notes removed across all communities. */
  notes: number
}

export async function deleteAccount(userId: string): Promise<DeleteAccountResult> {
  const memberships = await prisma.userCommunity.findMany({
    where: { userId },
    select: { communityId: true, status: true },
  })

  // Guard before we delete anything: a community must not be left unmanageable.
  for (const { communityId } of memberships) {
    try {
      await assertMembersCanLeave(communityId, [userId])
    } catch (e) {
      // 409, the same shape lib/messages/* uses for a service-level refusal.
      throw new ApiError(409, `${(e as Error).message} Hand ownership over, then delete your account.`)
    }
  }

  // Member nodes are found through `Identity.userId`, so they must be collected
  // before the identity row goes.
  const nodeIds: string[] = []
  for (const { communityId } of memberships) {
    const node = await findMemberNode(communityId, userId)
    if (node) nodeIds.push(node.id)
  }

  const activeCommunityIds = memberships.filter((m) => m.status === 'active').map((m) => m.communityId)

  const result = await prisma.$transaction(async (tx) => {
    // Personal brains (`ownerKey` = userId). Chunks cascade from their source,
    // but the delete is spelled out so a source-less chunk cannot be stranded.
    const notes = await tx.communityNote.deleteMany({ where: { ownerKey: userId } })
    await tx.communityNoteFolder.deleteMany({ where: { ownerKey: userId } })
    await tx.communityBrainFile.deleteMany({ where: { ownerKey: userId } })
    await tx.communityNoteEmbedding.deleteMany({ where: { ownerKey: userId } })
    await tx.contextSourceChunk.deleteMany({ where: { ownerKey: userId } })
    await tx.contextSource.deleteMany({ where: { ownerKey: userId } })

    // Access, in every community at once — what `removeMemberAccess` does per
    // community, plus the requests that outlive a denial.
    await tx.brainGrant.deleteMany({ where: { subjectType: 'user', subjectId: userId } })
    await tx.userAlias.deleteMany({ where: { userId } })
    await tx.brainAccessRequest.deleteMany({ where: { userId } })

    // MCP/OAuth credentials issued to them. Nothing cascades these, and an
    // outstanding refresh token would otherwise still be exchangeable.
    await tx.oAuthAuthCode.deleteMany({ where: { userId } })
    await tx.oAuthRefreshToken.deleteMany({ where: { userId } })

    if (nodeIds.length) await tx.node.deleteMany({ where: { id: { in: nodeIds } } })
    await tx.identity.deleteMany({ where: { userId } })
    await tx.person.deleteMany({ where: { userId } })

    // Only active members were counted when they joined.
    for (const communityId of activeCommunityIds) {
      await tx.community.update({
        where: { id: communityId },
        data: { memberCount: { decrement: 1 } },
      })
    }

    await tx.auditLog.create({
      data: {
        actorId: userId,
        targetId: userId,
        action: 'delete_account',
        diff: {
          communities: memberships.length,
          nodes: nodeIds.length,
          notes: notes.count,
        },
      },
    })

    // Last: cascades memberships, messages, posts, reactions, private columns
    // and the conversations they created.
    await tx.user.delete({ where: { id: userId } })

    return { communities: memberships.length, nodes: nodeIds.length, notes: notes.count }
  })

  logger.info('account.deleted', { userId, ...result })
  return result
}
