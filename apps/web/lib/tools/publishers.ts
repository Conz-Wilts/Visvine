/**
 * Publishers as Visvine knows them (`app_tool_publishers`): a publishing
 * space, and whether Visvine has verified it is who it says it is.
 *
 * Verification is Visvine's word, set by a reviewer, and it buys two things:
 * the publisher's listings after its first start at full reach rather than
 * staged (lib/tools/shared/listing.ts#initialStage), and its re-listings that
 * change nothing reviewed and come back clean from every stage are listed
 * without a person (registry.ts#shouldAutoApprove). It never skips an
 * automated stage.
 */
import prisma from '@/lib/prisma'
import { isSuperAdmin } from '@/lib/session'
import { logAudit } from '@/lib/notes/audit'
import type { RegistryError } from './registry'

/** Which of these spaces Visvine has verified. */
export async function verifiedPublishers(spaceIds: readonly string[]): Promise<Set<string>> {
  if (spaceIds.length === 0) return new Set()
  const rows = await prisma.appToolPublisher.findMany({
    where: { spaceId: { in: [...new Set(spaceIds)] }, verified: true },
    select: { spaceId: true },
  })
  return new Set(rows.map((row) => row.spaceId))
}

export async function isVerifiedPublisher(spaceId: string): Promise<boolean> {
  return (await verifiedPublishers([spaceId])).has(spaceId)
}

/** Visvine's word on a publisher. Reviewers only; verifying lifts the stage on its listings. */
export async function setPublisherVerified(
  spaceId: string,
  reviewer: { userId: string; email: string },
  verified: boolean,
  note?: string | null,
): Promise<{ ok: true } | RegistryError> {
  if (!isSuperAdmin(reviewer.email)) return { ok: false, status: 403, error: 'Only Visvine reviewers can verify a publisher.' }
  const now = new Date()
  const words = note?.trim() ? note.trim().slice(0, 500) : undefined
  await prisma.$transaction([
    prisma.appToolPublisher.upsert({
      where: { spaceId },
      create: { spaceId, verified, verifiedBy: verified ? reviewer.userId : null, verifiedAt: verified ? now : null, note: words ?? null },
      update: { verified, verifiedBy: verified ? reviewer.userId : null, verifiedAt: verified ? now : null, ...(words !== undefined ? { note: words } : {}) },
    }),
    ...(verified ? [prisma.appToolListing.updateMany({ where: { publisherSpaceId: spaceId }, data: { stagedUntil: null } })] : []),
  ])
  void logAudit(spaceId, {
    userId: reviewer.userId,
    name: reviewer.email,
    action: 'tool',
    path: 'tools',
    detail: verified ? 'verified as a publisher by Visvine' : 'no longer a verified publisher',
  })
  return { ok: true }
}
