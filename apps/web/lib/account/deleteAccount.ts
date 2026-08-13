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
 * rather than a foreign key — `owner_key` on the personal-context tables,
 * `user_id` on `user_aliases`, `subject_id` on `context_grants` — so Postgres
 * cascades cannot see it, and `Person.userId` is a nullable FK that would be
 * SET NULL, leaving the profile itself behind with nobody attached. Signing up
 * again with the same email would then land next to that orphan.
 *
 * What goes:
 *  - the profile (`Person`) and the cross-space `Identity` it was claimed by
 *  - the member node representing them in every space directory, and with it
 *    (via cascade) their links there
 *  - every personal context: notes, folders, files, embeddings, sources, chunks
 *  - context grants, aliases held, and outstanding access requests
 *  - the `User` row, which cascades memberships, messages, reactions, stars,
 *    and the conversations they created
 *
 * What stays, deliberately: notes other people wrote in a space's SHARED
 * context, even when the subject is the departing member — that text is the
 * space's, not theirs, and index notes point at it.
 *
 * Refused when they are the last person who can manage a space — the same
 * invariant that blocks an admin from removing that member (`assertOwnerSurvives`).
 * Ownership has to be handed over first.
 */

export interface DeleteAccountResult {
  /** Spaces they were a member of. */
  spaces: number
  /** Directory nodes removed (one per space that had one). */
  nodes: number
  /** Personal-context notes removed across all spaces. */
  notes: number
}

export async function deleteAccount(userId: string): Promise<DeleteAccountResult> {
  const memberships = await prisma.spaceMember.findMany({
    where: { userId },
    select: { spaceId: true, status: true },
  })

  // Guard before we delete anything: a space must not be left unmanageable.
  for (const { spaceId } of memberships) {
    try {
      await assertMembersCanLeave(spaceId, [userId])
    } catch (e) {
      // 409, the same shape lib/messages/* uses for a service-level refusal.
      throw new ApiError(409, `${(e as Error).message} Hand ownership over, then delete your account.`)
    }
  }

  // Member nodes are found through `Identity.userId`, so they must be collected
  // before the identity row goes.
  const nodeIds: string[] = []
  for (const { spaceId } of memberships) {
    const node = await findMemberNode(spaceId, userId)
    if (node) nodeIds.push(node.id)
  }

  const result = await prisma.$transaction(async (tx) => {
    // Personal contexts (`ownerKey` = userId). Chunks cascade from their source,
    // but the delete is spelled out so a source-less chunk cannot be stranded.
    const notes = await tx.contextNote.deleteMany({ where: { ownerKey: userId } })
    await tx.contextFolder.deleteMany({ where: { ownerKey: userId } })
    await tx.contextState.deleteMany({ where: { ownerKey: userId } })
    await tx.contextNoteEmbedding.deleteMany({ where: { ownerKey: userId } })
    await tx.contextSourceChunk.deleteMany({ where: { ownerKey: userId } })
    await tx.contextSource.deleteMany({ where: { ownerKey: userId } })

    // Access, in every space at once — what `removeMemberAccess` does per
    // space, plus the requests that outlive a denial.
    await tx.contextGrant.deleteMany({ where: { subjectType: 'user', subjectId: userId } })
    await tx.userAlias.deleteMany({ where: { userId } })
    await tx.contextAccessRequest.deleteMany({ where: { userId } })

    // MCP/OAuth credentials issued to them. Nothing cascades these, and an
    // outstanding refresh token would otherwise still be exchangeable.
    await tx.oAuthAuthCode.deleteMany({ where: { userId } })
    await tx.oAuthRefreshToken.deleteMany({ where: { userId } })

    if (nodeIds.length) await tx.node.deleteMany({ where: { id: { in: nodeIds } } })
    await tx.identity.deleteMany({ where: { userId } })
    await tx.person.deleteMany({ where: { userId } })

    // Last: cascades memberships, messages, reactions and the conversations
    // they created.
    await tx.user.delete({ where: { id: userId } })

    return { spaces: memberships.length, nodes: nodeIds.length, notes: notes.count }
  })

  logger.info('account.deleted', { userId, ...result })
  return result
}
