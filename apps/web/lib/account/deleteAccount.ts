import prisma from '@/lib/prisma'
import { ApiError } from '@/lib/api/route'
import { assertMembersCanLeave } from '@/lib/notes/aliases'
import { findMemberNode } from '@/lib/identity/connection'
import { logger } from '@/lib/logger'
import {
  purgeNodeObjects,
  purgePersonalContextObjects,
  purgeSpaceObjects,
} from '@/lib/storage/purge'

/**
 * What an audit entry's actor becomes when that person deletes their account.
 * A tombstone rather than a blank so the trail still reads as "somebody did
 * this", and so the rows are findable if a real erasure request ever needs to
 * go further.
 */
const DELETED_ACTOR_ID = 'deleted-user'
const DELETED_ACTOR_NAME = 'Deleted user'

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
 *  - their PERSONAL SPACE (`me:<userId>`) in full, and with it every note in it
 *  - the bytes: Drive files, uploaded originals and images, in both buckets
 *  - context grants, aliases held, and outstanding access requests
 *  - the `User` row, which cascades memberships, messages, reactions, stars,
 *    and the conversations they created
 *
 * The personal space is called out because it was the widest gap and the least
 * visible one. A personal space's notes are stored with `ownerKey = 'shared'`
 * INSIDE the space `me:<userId>` — the ownership is in the space id, not in the
 * owner key — so the `ownerKey = userId` sweep below never matched a single one
 * of them, and `personalOwnerId` has no foreign key for a cascade to follow.
 * Closing an account left the space row and every note in it standing, owned by
 * a user that no longer existed. The coverage guard in tests/delete-account.ts
 * structurally could not see it either: it reasons about COLUMNS on tables, and
 * this was a whole tenant.
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
  /** Personal spaces deleted in full (normally one, zero if never created). */
  personalSpaces: number
  /** GCS objects removed across both buckets. */
  objects: number
}

export async function deleteAccount(userId: string): Promise<DeleteAccountResult> {
  const memberships = await prisma.spaceMember.findMany({
    where: { userId },
    select: { spaceId: true, status: true },
  })

  // Their personal spaces. Found by `personalOwnerId`, which is a plain scalar
  // — no FK, so nothing cascades from the User row and these have to be named
  // explicitly. A membership row usually exists too, but not necessarily, and
  // the ownership claim is the one that decides.
  const personalSpaces = await prisma.space.findMany({
    where: { personalOwnerId: userId },
    select: { id: true },
  })

  // Guard before we delete anything: a space must not be left unmanageable.
  // A personal space is exempt — it is being deleted outright, and its owner
  // being its only possible admin is the definition of one.
  const personalIds = new Set(personalSpaces.map((s) => s.id))
  for (const { spaceId } of memberships.filter((m) => !personalIds.has(m.spaceId))) {
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

  // Bytes before rows, for the same reason the space route does it in that
  // order: the media bucket is keyed by entity id, so a node's images are only
  // findable while the node exists. Best-effort — a bucket outage must not be
  // able to block someone from closing their account, and
  // scripts/gc-orphan-objects.ts reconciles whatever a failure leaves behind.
  let objects = 0
  const otherSpaceIds = memberships.map((m) => m.spaceId).filter((id) => !personalIds.has(id))
  try {
    for (const { id } of personalSpaces) {
      const r = await purgeSpaceObjects(id)
      objects += r.resources + r.media
    }
    const r = await purgePersonalContextObjects(userId, otherSpaceIds)
    objects += r.resources + r.media
    // Their member node in each surviving space carries their photo.
    const n = await purgeNodeObjects(nodeIds)
    objects += n.media
  } catch (err) {
    logger.error('account.delete.purge_failed', { userId, err })
  }

  const result = await prisma.$transaction(async (tx) => {
    // Personal contexts (`ownerKey` = userId). Chunks cascade from their source,
    // but the delete is spelled out so a source-less chunk cannot be stranded.
    const notes = await tx.contextNote.deleteMany({ where: { ownerKey: userId } })
    await tx.contextFolder.deleteMany({ where: { ownerKey: userId } })
    await tx.contextState.deleteMany({ where: { ownerKey: userId } })
    await tx.contextNoteEmbedding.deleteMany({ where: { ownerKey: userId } })
    await tx.contextMemory.deleteMany({ where: { ownerKey: userId } })
    await tx.contextSourceChunk.deleteMany({ where: { ownerKey: userId } })
    await tx.contextSource.deleteMany({ where: { ownerKey: userId } })
    // Outbox rows for the personal context above. Deleted rather than redacted:
    // a projection job is a note to self about work still owed on notes that no
    // longer exist, so there is nothing left for it to rebuild and nothing about
    // it worth keeping. (The audit entries below are the opposite case, and are
    // redacted instead — see the note there.)
    await tx.noteProjectionJob.deleteMany({ where: { ownerKey: userId } })

    // Access, in every space at once — what `removeMemberAccess` does per
    // space, plus the requests that outlive a denial.
    await tx.contextGrant.deleteMany({ where: { subjectType: 'user', subjectId: userId } })
    await tx.userAlias.deleteMany({ where: { userId } })
    await tx.contextAccessRequest.deleteMany({ where: { userId } })

    // Queued publish/promotion proposals. `content` is a full snapshot of a
    // note from their PERSONAL context, so the row carries their data even
    // though it sits in a space — it goes with them. (Not caught by the
    // delete-account coverage guard: the column is `proposedBy`, not `userId`.)
    await tx.contextMoveProposal.deleteMany({ where: { proposedBy: userId } })

    // The audit trail is REDACTED, not deleted — the one deliberate exception
    // on this list. Every other row here is the person's own data; an audit
    // entry is the SPACE's record that something happened to its data (a
    // restricted note was read, a grant changed, a connector ran). If deleting
    // an account erased those, deleting an account would be how you erase your
    // own trail, which is the one thing an audit log exists to prevent. The
    // event survives; the person in it does not.
    await tx.contextAuditEntry.updateMany({
      where: { userId },
      data: { userId: DELETED_ACTOR_ID, name: DELETED_ACTOR_NAME },
    })

    // MCP/OAuth credentials issued to them. Nothing cascades these, and an
    // unconsumed authorization code would otherwise still be exchangeable.
    // Access tokens are stateless JWTs, so the residue is one hour of validity.
    await tx.oAuthAuthCode.deleteMany({ where: { userId } })

    // Their PERSONAL connector connections — tokens Visvine holds against
    // somebody else's service on their behalf. These outlive the account
    // otherwise, and each one is a live credential to a third party.
    //
    // Space connections (userId '') are deliberately untouched: they belong to
    // the space, not to whoever happened to click Connect, and deleting them
    // would break every other member and every scheduled agent. `connectedBy`
    // keeps the record of who set one up.
    await tx.connectorConnection.deleteMany({ where: { userId } })

    if (nodeIds.length) await tx.node.deleteMany({ where: { id: { in: nodeIds } } })
    await tx.identity.deleteMany({ where: { userId } })
    await tx.person.deleteMany({ where: { userId } })

    // Their personal space, in full. Its notes are `ownerKey = 'shared'` INSIDE
    // `me:<userId>`, so none of the ownerKey sweeps above touched them — the
    // ownership is expressed by the space id. Deleting the space row cascades
    // every FK-backed table beneath it (notes, folders, sidecar state,
    // embeddings, sources, chunks, grants, agents, tools, resources), which is
    // exactly what the space-delete route relies on.
    if (personalSpaces.length) {
      await tx.space.deleteMany({ where: { id: { in: personalSpaces.map((sp) => sp.id) } } })
    }

    // Last: cascades memberships, messages, reactions and the conversations
    // they created.
    await tx.user.delete({ where: { id: userId } })

    return {
      spaces: memberships.length,
      nodes: nodeIds.length,
      notes: notes.count,
      personalSpaces: personalSpaces.length,
      objects,
    }
  })

  logger.info('account.deleted', { userId, ...result })
  return result
}
