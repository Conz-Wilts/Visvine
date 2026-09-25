/**
 * A member's answer to a listed Tool's first-use notice (`app_tool_consents`).
 *
 * A Tool from outside the space asks each member once before it first acts as
 * them — writes notes or records, calls a connector, runs an agent or an
 * action, uses the space's AI. The bridge refuses such a call with
 * `consent_required` and the sentence to show; the HOST shows it, and on
 * Continue records the answer here and sends the call again. The answer is
 * kept with the acting reach it was given for, so an upgrade that only
 * narrows is still covered and one that widens asks again
 * (lib/tools/shared/listing.ts#consentCovers). A read-only Tool never asks,
 * and a Tool the space wrote itself never asks at all.
 */
import prisma from '@/lib/prisma'
import type { ActingReach } from './shared/listing'

function actingOfJson(raw: unknown): ActingReach | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  return {
    notes: list(r.notes),
    records: Array.isArray(r.records)
      ? r.records.flatMap((entry) => {
          const e = entry as Record<string, unknown> | null
          return e && typeof e.type === 'string' ? [{ type: e.type, fields: list(e.fields) }] : []
        })
      : [],
    connectors: list(r.connectors),
    agents: list(r.agents),
    actions: list(r.actions),
    ai: r.ai === true,
  }
}

/** What a member last said yes to for an install, or null when they never did. */
export async function consentFor(installId: string, userId: string): Promise<ActingReach | null> {
  const row = await prisma.appToolConsent.findUnique({
    where: { app_tool_consent_identity: { installId, userId } },
    select: { acting: true },
  })
  return row ? actingOfJson(row.acting) : null
}

/** Remember a member's Continue, for the acting reach they were shown. */
export async function giveConsent(installId: string, userId: string, acting: ActingReach): Promise<void> {
  await prisma.appToolConsent.upsert({
    where: { app_tool_consent_identity: { installId, userId } },
    create: { installId, userId, acting: acting as unknown as object },
    update: { acting: acting as unknown as object, consentedAt: new Date() },
  })
}
