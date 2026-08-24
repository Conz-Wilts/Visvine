/**
 * Invitations — an admin asking, the person answering.
 *
 * The old "invite by email" made someone a member the moment an admin typed
 * their address. Now it writes a `space_invitations` row and sends them a
 * `space_invite` notification; the membership, the aliases and the directory
 * node are all written by `respondToInvitation` when they accept. Nobody joins
 * a space they didn't agree to join, and an admin who invites the wrong person
 * has handed over nothing.
 *
 * An invitation still only reaches an address that already has an account —
 * there is no email channel here, the bell is the inbox (docs/notifications.md).
 */

import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { loadPersonAliases } from '@/lib/notes/aliases'
import { findAliasByRef } from '@/lib/types/context'
import { ensureMemberNode } from '@/lib/spaces/memberNode'
import { joinChildDenial } from '@/lib/spaces/hierarchy'
import { isActiveMemberOf } from '@/lib/spaces/tree'
import { notify } from '@/lib/notifications/service'
import { invitationHref } from '@/lib/notifications/types'

type InvitationStatus = 'pending' | 'accepted' | 'declined'

/** One invitation as the admin console and the bell see it. */
export interface InvitationDTO {
  id: string
  spaceId: string
  spaceName: string
  status: InvitationStatus | string
  /** Alias NAMES, resolved for display — the row stores ids. */
  aliases: string[]
  createdAt: string
  respondedAt: string | null
  invitedBy: { id: string; name: string } | null
  user: { id: string; name: string; email: string; image: string | null }
}

export type InviteResult =
  | { ok: true; invitation: InvitationDTO }
  | { ok: false; status: 404 | 409; error: string }

export type RespondResult =
  | { ok: true; action: 'accepted' | 'declined'; spaceId: string }
  | { ok: false; status: 400 | 404 | 409; error: string }

type Row = {
  id: string
  spaceId: string
  userId: string
  invitedBy: string | null
  aliasIds: string[]
  status: string
  createdAt: Date
  respondedAt: Date | null
  space: { name: string }
  user: { id: string; name: string; email: string; image: string | null }
  inviter: { id: string; name: string } | null
}

const WITH_RELATIONS = {
  space: { select: { name: true } },
  user: { select: { id: true, name: true, email: true, image: true } },
  inviter: { select: { id: true, name: true } },
} as const

function toDTO(row: Row, aliasNames: string[]): InvitationDTO {
  return {
    id: row.id,
    spaceId: row.spaceId,
    spaceName: row.space.name,
    status: row.status,
    aliases: aliasNames,
    createdAt: row.createdAt.toISOString(),
    respondedAt: row.respondedAt ? row.respondedAt.toISOString() : null,
    invitedBy: row.inviter ? { id: row.inviter.id, name: row.inviter.name } : null,
    user: row.user,
  }
}

/** Alias ids → the names they currently go by; unknown ids are dropped. */
async function aliasNames(spaceId: string, aliasIds: readonly string[]): Promise<string[]> {
  if (aliasIds.length === 0) return []
  const vocabulary = await loadPersonAliases(spaceId)
  return aliasIds
    .map((id) => vocabulary.find((a) => a.id === id)?.name)
    .filter((n): n is string => Boolean(n))
}

/**
 * Invite `email` to `spaceId` with the aliases the admin ticked. Refuses an
 * address with no account (404 — a form that silently swallows a typo is a
 * trap), someone who is already a member, and a second live invitation.
 * Re-inviting after a decline is allowed: the answered row is overwritten.
 */
export async function inviteMember(input: {
  spaceId: string
  email: string
  aliases?: string[]
  invitedBy: { id: string; name: string }
}): Promise<InviteResult> {
  const { spaceId, invitedBy } = input
  const email = input.email.trim().toLowerCase()

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true, name: true },
  })
  if (!user) return { ok: false, status: 404, error: 'No user found with that email' }

  const member = await prisma.spaceMember.findUnique({
    where: { userId_spaceId: { userId: user.id, spaceId } },
    select: { status: true },
  })
  if (member) {
    return {
      ok: false,
      status: 409,
      error: member.status === 'pending' ? 'They are already waiting for approval' : 'They are already a member',
    }
  }

  const existing = await prisma.spaceInvitation.findUnique({
    where: { spaceId_userId: { spaceId, userId: user.id } },
    select: { status: true },
  })
  if (existing?.status === 'pending') {
    return { ok: false, status: 409, error: 'They already have an invitation waiting' }
  }

  // Only aliases this space actually defines, resolved from the names the form
  // sent to the ids the row stores — an alias renamed while the invitation
  // waits is still the alias the admin picked.
  const vocabulary = await loadPersonAliases(spaceId)
  const resolved = (input.aliases ?? [])
    .map((a) => findAliasByRef(vocabulary, a, 'Person'))
    .filter((a) => Boolean(a?.id))
  const aliasIds = [...new Set(resolved.map((a) => a!.id!))]

  const row = (await prisma.spaceInvitation.upsert({
    where: { spaceId_userId: { spaceId, userId: user.id } },
    create: { spaceId, userId: user.id, invitedBy: invitedBy.id, aliasIds, status: 'pending' },
    update: { invitedBy: invitedBy.id, aliasIds, status: 'pending', respondedAt: null, createdAt: new Date() },
    include: WITH_RELATIONS,
  })) as Row

  const names = await aliasNames(spaceId, aliasIds)
  const spaceName = row.space.name
  void notify([user.id], {
    // Deliberately NOT stamped with the space. An invitation is the one
    // notification about a space you are not in — filed under it, it would sit
    // behind a tab the invitee has no way to open (lib/notifications/types.ts).
    spaceId: null,
    kind: 'space_invite',
    title: `${invitedBy.name} invited you to ${spaceName}`,
    body: names.length
      ? `You'd join as ${names.join(', ')}. Nothing happens until you accept.`
      : 'Nothing happens until you accept.',
    // The href carries the invitation id so the bell can find the row to answer
    // — the same trick `agent_question` uses to name its agent. It is not a
    // page: the bell answers it in place rather than navigating.
    href: invitationHref(row.id),
    dedupeKey: `space_invite:${row.id}`,
  })

  return { ok: true, invitation: toDTO(row, names) }
}

/** Pending invitations for a space, newest first — the admin's side. */
export async function listSpaceInvitations(spaceId: string): Promise<InvitationDTO[]> {
  const rows = (await prisma.spaceInvitation.findMany({
    where: { spaceId, status: 'pending' },
    include: WITH_RELATIONS,
    orderBy: { createdAt: 'desc' },
  })) as Row[]
  const vocabulary = await loadPersonAliases(spaceId)
  return rows.map((row) =>
    toDTO(
      row,
      row.aliasIds.map((id) => vocabulary.find((a) => a.id === id)?.name).filter((n): n is string => Boolean(n)),
    ),
  )
}

/** The invitations waiting on this person — what the bell's accept box acts on. */
export async function listMyInvitations(userId: string): Promise<InvitationDTO[]> {
  const rows = (await prisma.spaceInvitation.findMany({
    where: { userId, status: 'pending' },
    include: WITH_RELATIONS,
    orderBy: { createdAt: 'desc' },
    take: 50,
  })) as Row[]
  return Promise.all(rows.map(async (row) => toDTO(row, await aliasNames(row.spaceId, row.aliasIds))))
}

const ALREADY_ANSWERED = {
  ok: false,
  status: 409,
  error: 'This invitation has already been answered',
} as const satisfies RespondResult

/**
 * Move a still-pending row to its answer, atomically. False when somebody got
 * there first — the read that decided to call this is always a little stale, so
 * the transition itself has to be the check.
 */
async function claim(
  id: string,
  userId: string,
  status: 'accepted' | 'declined',
  client: Pick<typeof prisma, 'spaceInvitation'> = prisma,
): Promise<boolean> {
  const res = await client.spaceInvitation.updateMany({
    where: { id, userId, status: 'pending' },
    data: { status, respondedAt: new Date() },
  })
  return res.count > 0
}

/**
 * The invitee's answer. Accepting writes the membership, the staged aliases and
 * the directory node — the work the admin's POST used to do — and tells the
 * inviter. Declining just closes the row; the inviter is told that too, because
 * an invitation that vanishes silently reads as a bug.
 *
 * Only the row's own invitee can answer it, and only once: a row that is no
 * longer pending is a 409, not a second membership.
 */
export async function respondToInvitation(
  userId: string,
  invitationId: string,
  action: 'accept' | 'decline',
): Promise<RespondResult> {
  const row = (await prisma.spaceInvitation.findFirst({
    where: { id: invitationId, userId },
    include: WITH_RELATIONS,
  })) as Row | null
  if (!row) return { ok: false, status: 404, error: 'No such invitation' }
  if (row.status !== 'pending') return ALREADY_ANSWERED

  const { spaceId } = row
  const spaceName = row.space.name
  const who = row.user.name

  if (action === 'decline') {
    if (!(await claim(row.id, userId, 'declined'))) return ALREADY_ANSWERED
    if (row.invitedBy) {
      void notify([row.invitedBy], {
        spaceId,
        kind: 'space_invite_answered',
        title: `${who} declined your invitation to ${spaceName}`,
      })
    }
    return { ok: true, action: 'declined', spaceId }
  }

  // The aliases the admin staged. Ids that no longer exist are skipped rather
  // than failing the accept: the space's vocabulary moved on, the answer still
  // stands. Read before the transaction — it is a read, and the transaction
  // wants to be as short as it can be.
  const vocabulary = await loadPersonAliases(spaceId)
  const grantedIds = row.aliasIds.filter((id) => vocabulary.some((a) => a.id === id))

  // A child's member is a member of its parent (docs/sub-spaces.md): a public
  // parent is joined alongside, a private one has to have been joined first.
  const parent = (await prisma.space.findUnique({
    where: { id: spaceId },
    select: { parent: { select: { id: true, name: true, visibility: true } } },
  }))?.parent ?? null
  const parentMember = parent ? await isActiveMemberOf(userId, parent.id) : true
  const parentDenied = joinChildDenial(parent, parentMember)
  if (parentDenied) return { ok: false, status: 400, error: parentDenied }

  // Claim, membership and aliases together, or not at all. The claim is the
  // compare-and-swap: two answers racing (a double-click, two tabs) means one
  // of them updates zero rows and does no work, rather than both getting past
  // the `pending` read above and the loser dying on the membership unique.
  // Between the invitation and the answer they may also have joined another
  // way, which is why the membership is an upsert rather than a create.
  const claimed = await prisma.$transaction(async (tx) => {
    if (!(await claim(row.id, userId, 'accepted', tx))) return false

    if (parent && !parentMember) {
      await tx.spaceMember.upsert({
        where: { userId_spaceId: { userId, spaceId: parent.id } },
        create: { userId, spaceId: parent.id, status: 'active', addedBy: row.invitedBy ?? undefined },
        update: {},
      })
    }
    await tx.spaceMember.upsert({
      where: { userId_spaceId: { userId, spaceId } },
      create: { userId, spaceId, status: 'active', addedBy: row.invitedBy ?? undefined },
      update: {},
    })

    if (grantedIds.length) {
      await tx.userAlias.createMany({
        data: grantedIds.map((aliasId) => ({ spaceId, aliasId, userId, addedBy: row.invitedBy ?? undefined })),
        skipDuplicates: true,
      })
    }
    return true
  })
  if (!claimed) return ALREADY_ANSWERED

  // Directory node — best-effort, the same as every other join path.
  try {
    await ensureMemberNode(spaceId, userId, { id: userId, name: who, email: row.user.email })
  } catch (err) {
    logger.error('invitations.member_node.failed', { err, spaceId, userId })
  }

  if (row.invitedBy) {
    void notify([row.invitedBy], {
      spaceId,
      kind: 'space_invite_answered',
      title: `${who} accepted your invitation to ${spaceName}`,
      href: '/admin?section=people',
    })
  }

  return { ok: true, action: 'accepted', spaceId }
}

/** An admin withdrawing an invitation nobody answered. */
export async function cancelInvitation(spaceId: string, invitationId: string): Promise<boolean> {
  const res = await prisma.spaceInvitation.deleteMany({ where: { id: invitationId, spaceId, status: 'pending' } })
  return res.count > 0
}
