/**
 * A space's line: assigned by Visvine, switched by the space (docs/imessage.md).
 *
 * Assignment is a super-admin's act because a line costs money and there is a
 * finite number on the account. The space's admin owns everything after that:
 * the on/off switch (`featureConfig.enabled.imessage`), the shown name, and
 * the `phone` brief.
 */
import prisma from '@/lib/prisma'
import { isFeatureEnabled } from '@/lib/featureAccess'
import type { SpaceFeatureConfig } from '@/lib/types'
import { normalizePhone } from './shared/phone'

export const IMESSAGE_FEATURE_KEY = 'imessage'

export interface LineRow {
  id: string
  spaceId: string
  number: string
  name: string | null
  status: 'active' | 'suspended'
  profileAt: Date | null
}

export async function lineForSpace(spaceId: string): Promise<LineRow | null> {
  const row = await prisma.imessageLine.findUnique({ where: { spaceId } })
  return row ? { ...row, status: row.status === 'suspended' ? 'suspended' : 'active' } : null
}

export async function lineByNumber(number: string): Promise<LineRow | null> {
  const row = await prisma.imessageLine.findUnique({ where: { number } })
  return row ? { ...row, status: row.status === 'suspended' ? 'suspended' : 'active' } : null
}

export type AssignResult = { ok: true; line: LineRow } | { ok: false; status: number; error: string }

/** Give a space a line. One per space, one space per line; a re-assign moves it. */
export async function assignLine(spaceId: string, rawNumber: string): Promise<AssignResult> {
  const number = normalizePhone(rawNumber)
  if (!number) return { ok: false, status: 400, error: 'That is not a phone number.' }
  const space = await prisma.space.findUnique({ where: { id: spaceId }, select: { id: true, personalOwnerId: true } })
  if (!space) return { ok: false, status: 404, error: 'Unknown space.' }
  if (space.personalOwnerId) return { ok: false, status: 400, error: 'A personal space cannot hold a line.' }
  const taken = await prisma.imessageLine.findUnique({ where: { number }, select: { spaceId: true } })
  if (taken && taken.spaceId !== spaceId) return { ok: false, status: 409, error: 'That line is assigned to another space.' }
  const row = await prisma.imessageLine.upsert({
    where: { spaceId },
    create: { spaceId, number },
    update: { number, status: 'active' },
  })
  return { ok: true, line: { ...row, status: 'active' } }
}

export async function unassignLine(spaceId: string): Promise<boolean> {
  const r = await prisma.imessageLine.deleteMany({ where: { spaceId } })
  return r.count > 0
}

export async function renameLine(spaceId: string, name: string | null): Promise<LineRow | null> {
  const trimmed = name?.trim().slice(0, 60) || null
  const row = await prisma.imessageLine.update({ where: { spaceId }, data: { name: trimmed } }).catch(() => null)
  return row ? { ...row, status: row.status === 'suspended' ? 'suspended' : 'active' } : null
}

/** The space's switch, read off its featureConfig like every other tool. */
export function imessageOn(featureConfig: unknown): boolean {
  return isFeatureEnabled((featureConfig ?? null) as SpaceFeatureConfig | null, IMESSAGE_FEATURE_KEY)
}
