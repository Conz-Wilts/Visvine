/**
 * Pulling a Tool back after it was approved.
 *
 * Two holds, each in its own columns so `status` / `marketplaceStatus` keep
 * meaning only "what the review decided":
 *
 *   version revoked      the source space's admins (or a Visvine reviewer) pull
 *                        ONE version. It stops everywhere it runs — the source
 *                        space, its rooms, every space that installed it.
 *   listing suspended    Visvine holds a Tool's global LISTING. Every install
 *   listing revoked      outside the publisher's own family stops, whatever
 *                        version it pins. Suspended is reversible; revoked is
 *                        not, and those installs are flagged for removal.
 *
 * Both are read wherever a version is chosen or run: every bridge call, frame
 * mint and changes stream (lib/tools/target.ts), a fresh install and an
 * upgrade (`installability`), and share-down's version pick. A running frame
 * stops because its HOST is told — the bridge answers `revoked`, the changes
 * stream pushes it where it can, and the host re-checks once a minute — never
 * because a token expired: a frame token is checked once, when the frame loads.
 *
 * `runDenial` is pure (tests/tools-verdicts.test.ts); the rest is thin rows.
 */
import { EventEmitter } from 'node:events'
import prisma from '@/lib/prisma'
import { isAdmin } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/session'
import { logAudit } from '@/lib/notes/audit'
import { toolIndexPath } from './config'
import type { BridgeError } from './protocol'

export type ListingState = 'active' | 'suspended' | 'revoked'

const LISTING_STATES: readonly ListingState[] = ['active', 'suspended', 'revoked']

export function decodeListingState(raw: string | null | undefined): ListingState {
  return (LISTING_STATES as readonly string[]).includes(raw ?? '') ? (raw as ListingState) : 'active'
}

export interface VersionHold {
  revokedAt: Date | string | null
  revokeReason: string | null
}

export interface ListingHold {
  state: ListingState
  stateReason: string | null
}

function withReason(sentence: string, reason: string | null | undefined): string {
  const r = reason?.trim()
  return r ? `${sentence} — ${r}` : sentence
}

/**
 * Whether a version may run for an install in `installSpaceId`, and the
 * sentence the host shows when it may not. `sharedFromSpaceId` is the house an
 * install came down from: a room running its house's Tool got it from its own
 * family, not from the listing, so only a version revoke reaches it.
 */
export function runDenial(input: {
  version: VersionHold
  listing: ListingHold | null
  sourceSpaceId: string
  installSpaceId: string
  sharedFromSpaceId?: string | null
}): BridgeError | null {
  if (input.version.revokedAt) {
    return { code: 'revoked', message: withReason('Withdrawn by the space that made it', input.version.revokeReason) }
  }
  const family = input.installSpaceId === input.sourceSpaceId || input.sharedFromSpaceId === input.sourceSpaceId
  if (!family && input.listing && input.listing.state !== 'active') {
    const sentence = input.listing.state === 'suspended' ? 'Suspended by Visvine' : 'Removed by Visvine'
    return { code: 'revoked', message: withReason(sentence, input.listing.stateReason) }
  }
  return null
}

/** The listing hold for a Tool key, or null when it was never listed. */
export async function listingHoldFor(key: string): Promise<ListingHold | null> {
  const row = await prisma.appToolListing.findUnique({
    where: { key },
    select: { state: true, stateReason: true },
  })
  return row ? { state: decodeListingState(row.state), stateReason: row.stateReason } : null
}

// ── telling running frames ────────────────────────────────────────────────────

/**
 * In-process only, like the note change bus: a changes stream open on THIS
 * instance hears it at once; every other frame learns at its next bridge call
 * or its host's minute check.
 */
export interface VerdictEvent {
  /** Set when one version was pulled. */
  versionId?: string
  /** Set when a whole listing changed state. */
  key?: string
}

declare global {
  var __vvToolVerdicts: EventEmitter | undefined
}

function bus(): EventEmitter {
  if (!globalThis.__vvToolVerdicts) {
    globalThis.__vvToolVerdicts = new EventEmitter()
    globalThis.__vvToolVerdicts.setMaxListeners(0)
  }
  return globalThis.__vvToolVerdicts
}

function publishVerdict(event: VerdictEvent): void {
  bus().emit('verdict', event)
}

export function subscribeVerdicts(listener: (event: VerdictEvent) => void): () => void {
  bus().on('verdict', listener)
  return () => bus().off('verdict', listener)
}

// ── the acts ─────────────────────────────────────────────────────────────────

export type VerdictResult = { ok: true } | { ok: false; status: number; error: string }

/**
 * Pull one approved version. The source space's admins may (it is their code);
 * so may a Visvine reviewer. Offers of it as an upgrade are withdrawn, so no
 * install moves onto it.
 */
export async function revokeVersion(
  versionId: string,
  actor: { userId: string; email: string },
  reason: string | null,
): Promise<VerdictResult> {
  const row = await prisma.appToolVersion.findUnique({
    where: { id: versionId },
    select: { id: true, key: true, name: true, version: true, status: true, sourceSpaceId: true, revokedAt: true },
  })
  if (!row) return { ok: false, status: 404, error: 'No such tool version.' }
  const reviewer = isSuperAdmin(actor.email)
  if (!reviewer && !(await isAdmin(actor.userId, row.sourceSpaceId, actor.email))) {
    return { ok: false, status: 403, error: 'Only an admin of the space that made this tool can withdraw it.' }
  }
  if (row.status !== 'approved') {
    return { ok: false, status: 409, error: `This version is ${row.status}, not approved — there is nothing running to withdraw.` }
  }
  if (row.revokedAt) return { ok: false, status: 409, error: 'This version is already withdrawn.' }

  const note = reason?.trim() ? reason.trim().slice(0, 500) : null
  await prisma.$transaction([
    prisma.appToolVersion.update({
      where: { id: versionId },
      data: { revokedAt: new Date(), revokedBy: actor.userId, revokeReason: note },
    }),
    prisma.appToolInstall.updateMany({ where: { pendingVersionId: versionId }, data: { pendingVersionId: null } }),
  ])
  void logAudit(row.sourceSpaceId, {
    userId: actor.userId,
    name: actor.email,
    action: 'tool',
    path: toolIndexPath(row.name),
    detail: `withdrew v${row.version}${reviewer ? ' (Visvine)' : ''}${note ? ` — ${note}` : ''}`,
  })
  publishVerdict({ versionId })
  return { ok: true }
}

/**
 * Visvine's hold over a whole listing. `revoked` is final: a revoked listing
 * never goes back to active, and the installs it stopped are the installing
 * admins' to remove.
 */
export async function setListingState(
  key: string,
  state: ListingState,
  reviewer: { userId: string; email: string },
  reason: string | null,
): Promise<VerdictResult> {
  if (!isSuperAdmin(reviewer.email)) {
    return { ok: false, status: 403, error: 'Only Visvine reviewers can hold a listing.' }
  }
  const row = await prisma.appToolListing.findUnique({ where: { key }, select: { state: true, publisherSpaceId: true } })
  if (!row) return { ok: false, status: 404, error: 'This tool was never listed.' }
  const current = decodeListingState(row.state)
  if (current === 'revoked') return { ok: false, status: 409, error: 'This listing was removed for good.' }
  if (current === state) return { ok: true }

  const note = reason?.trim() ? reason.trim().slice(0, 500) : null
  await prisma.appToolListing.update({
    where: { key },
    data: { state, stateReason: note, stateBy: reviewer.userId, stateAt: new Date() },
  })
  const name = key.slice(key.indexOf('/') + 1)
  void logAudit(row.publisherSpaceId, {
    userId: reviewer.userId,
    name: reviewer.email,
    action: 'tool',
    path: toolIndexPath(name),
    detail: `listing ${state} by Visvine${note ? ` — ${note}` : ''}`,
  })
  publishVerdict({ key })
  return { ok: true }
}

/** The listing row for a key, made when a version is first submitted for one. */
export async function ensureListing(key: string, publisherSpaceId: string): Promise<void> {
  await prisma.appToolListing.upsert({
    where: { key },
    create: { key, publisherSpaceId },
    update: {},
  })
}
