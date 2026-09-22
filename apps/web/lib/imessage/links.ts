/**
 * A person's phone, bound to their account (docs/imessage.md § Linking).
 *
 * The binding IS the authentication for every text that follows, so it is
 * made the way a password reset is: a short-lived code the person proves they
 * hold — by texting it FROM the phone being claimed to any line they can
 * reach. Nothing here sends a message; `verifyLinkCode` is called by the
 * inbound door when a code arrives. One account per phone, one phone per
 * account.
 */
import { randomBytes } from 'node:crypto'
import prisma from '@/lib/prisma'
import { takeToken } from '@/lib/rateLimit'
import { normalizePhone } from './shared/phone'
import { LINK_CODE_TTL_MS, codeIsLive, linkCodeFrom } from './shared/link'

export interface LinkRow {
  phone: string
  verifiedAt: Date | null
  /** Live only while unverified. */
  code: string | null
  codeExpiresAt: Date | null
}

export async function linkForUser(userId: string): Promise<LinkRow | null> {
  const row = await prisma.imessageLink.findFirst({ where: { userId }, select: { phone: true, verifiedAt: true, code: true, codeExpiresAt: true } })
  return row ?? null
}

/** The account a phone speaks for, or null when none is verified. */
export async function userForPhone(phone: string): Promise<{ userId: string; name: string; email: string } | null> {
  const row = await prisma.imessageLink.findUnique({
    where: { phone },
    select: { verifiedAt: true, user: { select: { id: true, name: true, email: true } } },
  })
  if (!row?.verifiedAt) return null
  return { userId: row.user.id, name: row.user.name ?? row.user.email ?? 'a member', email: row.user.email ?? '' }
}

export type StartLinkResult =
  | { ok: true; phone: string; code: string; expiresAt: Date }
  | { ok: false; status: number; error: string }

/** Codes are cheap to mint and a guess is 1 in a million, but a person asking for fifty is a bug or a probe. */
const START_LIMIT = { capacity: 5, refillPerSec: 1 / 120 }

/**
 * Begin (or restart) linking: writes the phone against the account with a
 * fresh code. Replaces any earlier phone of theirs — one phone per account —
 * and refuses a phone another account has verified.
 */
export async function startLink(userId: string, rawPhone: string, now = new Date()): Promise<StartLinkResult> {
  const phone = normalizePhone(rawPhone)
  if (!phone) return { ok: false, status: 400, error: 'That is not a phone number.' }
  const limit = await takeToken(`imessage:link:${userId}`, START_LIMIT)
  if (!limit.ok) return { ok: false, status: 429, error: 'Too many codes — try again in a few minutes.' }
  const taken = await prisma.imessageLink.findUnique({ where: { phone }, select: { userId: true, verifiedAt: true } })
  if (taken && taken.userId !== userId && taken.verifiedAt) return { ok: false, status: 409, error: 'That number is linked to another account.' }

  const code = linkCodeFrom(randomBytes(8))
  const expiresAt = new Date(now.getTime() + LINK_CODE_TTL_MS)
  await prisma.$transaction(async (tx) => {
    // An unverified claim by someone else on this phone gives way: possession
    // decides, and they never proved it.
    await tx.imessageLink.deleteMany({ where: { OR: [{ userId }, { phone, verifiedAt: null }] } })
    await tx.imessageLink.create({ data: { userId, phone, code, codeExpiresAt: expiresAt } })
  })
  return { ok: true, phone, code, expiresAt }
}

export async function removeLink(userId: string): Promise<boolean> {
  const r = await prisma.imessageLink.deleteMany({ where: { userId } })
  return r.count > 0
}

/**
 * A code arrived from `phone`. Verifies when it matches the live code on that
 * phone's pending link; returns the account it now speaks for.
 */
export async function verifyLinkCode(phone: string, code: string, now = new Date()): Promise<{ userId: string; name: string } | null> {
  const row = await prisma.imessageLink.findUnique({
    where: { phone },
    select: { id: true, code: true, codeExpiresAt: true, verifiedAt: true, user: { select: { id: true, name: true, email: true } } },
  })
  if (!row || row.verifiedAt || !codeIsLive(row.code, row.codeExpiresAt, now) || row.code !== code) return null
  await prisma.imessageLink.update({ where: { id: row.id }, data: { verifiedAt: now, code: null, codeExpiresAt: null } })
  return { userId: row.user.id, name: row.user.name ?? row.user.email ?? 'you' }
}

/** How many of a space's active members have a verified phone — the console's `12 linked`. */
export async function countLinkedMembers(spaceId: string): Promise<number> {
  return prisma.imessageLink.count({
    where: { verifiedAt: { not: null }, user: { memberships: { some: { spaceId, status: 'active' } } } },
  })
}

/** The lines a person could text a code to: spaces they are in that hold one. */
export async function reachableLines(userId: string): Promise<Array<{ spaceId: string; spaceName: string; number: string }>> {
  const rows = await prisma.imessageLine.findMany({
    where: { status: 'active', space: { members: { some: { userId, status: 'active' } } } },
    select: { spaceId: true, number: true, space: { select: { name: true } } },
    orderBy: { space: { name: 'asc' } },
  })
  return rows.map((r) => ({ spaceId: r.spaceId, spaceName: r.space.name, number: r.number }))
}
