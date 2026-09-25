/**
 * Going global — the acts between a version its space approved and a Tool
 * every space can install (docs/tools.md § Going global).
 *
 *   request     a space admin asks Visvine to list an approved version
 *   co-sign     the author consents, under a license — automatic when the
 *               admin asking IS the author. Only then is the version in
 *               Visvine's queue (`marketplaceStatus: pending`), and only then
 *               do the global stages run (lib/tools/review)
 *   withdraw    the admin or the author takes a request back; the author
 *               takes back a version still waiting on their own space
 *   list        Visvine approves (registry.ts#reviewVersion), and the listing
 *               starts staged when its publisher is new or unverified
 *   transfer    the publisher's admins offer the listing to another space and
 *               that space's admins accept, naming the Tool that carries it on;
 *               the listing's id stays, so every install keeps its upgrades
 *
 * A listing is its own row (`app_tool_listings`), named by id; its `key` is
 * the Tool it names NOW. Every version offered under it and every install of
 * one carries the id.
 *
 * Refusals come back as `{ ok: false, status, error }`, like the registry's.
 */
import prisma from '@/lib/prisma'
import { isAdmin } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/session'
import { logAudit } from '@/lib/notes/audit'
import { manifestOf, toolIndexPath } from './config'
import {
  decodeToolConfig,
  getVersionSummary,
  toolKey,
  withdrawVersion,
  type RegistryError,
  type ToolVersionSummary,
} from './registry'
import { decodeListingState } from './verdicts'
import {
  initialStage,
  listingRequestState,
  parseLicense,
  stagedInstallDenial,
  type ListingRequestState,
} from './shared/listing'
import { enqueueReview } from './review/queue'

type Admin = { userId: string; email: string; spaceId: string; isAdmin: boolean }
type Person = { userId: string; email: string }

export type ListingResult = { ok: true; version: ToolVersionSummary; state: ListingRequestState } | RegistryError

const VERSION_SELECT = {
  id: true,
  key: true,
  name: true,
  version: true,
  title: true,
  status: true,
  config: true,
  sourceSpaceId: true,
  authorUserId: true,
  marketplaceStatus: true,
  revokedAt: true,
  listingId: true,
  listingRequestedAt: true,
  cosignedAt: true,
} as const

async function answer(versionId: string): Promise<ListingResult> {
  const version = await getVersionSummary(versionId)
  if (!version) return { ok: false, status: 404, error: 'No such tool version.' }
  return { ok: true, version, state: version.listingState }
}

/** The listing row for a key, made the first time a version of it is offered. Returns its id. */
async function listingIdFor(key: string, publisherSpaceId: string): Promise<string> {
  const row = await prisma.appToolListing.upsert({
    where: { key },
    create: { key, publisherSpaceId },
    update: {},
    select: { id: true },
  })
  return row.id
}

/**
 * A space admin asking Visvine to list one of their space's approved
 * versions. Co-signed in the same act when the admin wrote it; otherwise it
 * waits on the author, who sees it on the Tool's tab and in Activity.
 */
export async function requestListing(
  versionId: string,
  actor: Admin,
  opts: { note?: string; license?: string } = {},
): Promise<ListingResult> {
  const row = await prisma.appToolVersion.findUnique({ where: { id: versionId }, select: VERSION_SELECT })
  if (!row) return { ok: false, status: 404, error: 'No such tool version.' }
  if (row.sourceSpaceId !== actor.spaceId) return { ok: false, status: 403, error: 'Only the space that wrote a tool can list it.' }
  if (!actor.isAdmin) return { ok: false, status: 403, error: 'Only space admins can ask Visvine to list a tool.' }
  if (row.revokedAt) return { ok: false, status: 409, error: 'This version was withdrawn — it cannot be listed.' }
  if (row.status !== 'approved') {
    return { ok: false, status: 409, error: 'Approve this version in your own space before offering it to anyone else.' }
  }
  const state = listingRequestState(row)
  if (state === 'listed') return { ok: false, status: 409, error: 'This version is already listed.' }
  if (state === 'in_review') return { ok: false, status: 409, error: 'This version is already with Visvine.' }
  if (state === 'awaiting_cosign') return { ok: false, status: 409, error: 'This version is already waiting on its author.' }

  const listing = await prisma.appToolListing.findFirst({
    where: row.listingId ? { id: row.listingId } : { key: row.key },
    select: { id: true, state: true, publisherSpaceId: true },
  })
  if (listing && decodeListingState(listing.state) === 'revoked') {
    return { ok: false, status: 409, error: 'Visvine removed this tool’s listing for good.' }
  }
  const busy = await prisma.appToolVersion.count({
    where: {
      key: row.key,
      id: { not: versionId },
      OR: [{ marketplaceStatus: 'pending' }, { marketplaceStatus: null, listingRequestedAt: { not: null }, cosignedAt: null }],
    },
  })
  if (busy > 0) {
    return { ok: false, status: 409, error: 'Another version of this tool is already on its way to Visvine — withdraw it first.' }
  }

  // The author co-signs as they ask; anyone else's request waits for them.
  const selfSigned = row.authorUserId === actor.userId
  let license: string | null = null
  if (selfSigned) {
    const parsed = parseLicense(opts.license ?? manifestOf(decodeToolConfig(row.config, row.name)).license)
    if (!parsed.ok) return { ok: false, status: 400, error: parsed.error }
    license = parsed.license
  }

  const listingId = listing?.id ?? (await listingIdFor(row.key, row.sourceSpaceId))
  const now = new Date()
  await prisma.appToolVersion.update({
    where: { id: versionId },
    data: {
      listingId,
      listingRequestedBy: actor.userId,
      listingRequestedAt: now,
      marketplaceReviewNote: opts.note?.trim() ? opts.note.trim().slice(0, 4000) : null,
      // A request from before is replaced, never stacked: one version, one ask.
      cosignedBy: null,
      cosignedAt: null,
      marketplaceStatus: null,
      marketplaceSubmittedAt: null,
      marketplaceReviewedAt: null,
      marketplaceReviewedBy: null,
    },
  })
  void logAudit(row.sourceSpaceId, {
    userId: actor.userId,
    name: actor.email,
    action: 'tool',
    path: toolIndexPath(row.name),
    detail: `asked Visvine to list v${row.version}${selfSigned ? '' : ' — waiting on its author'}`,
  })
  if (selfSigned) return cosign(versionId, { userId: actor.userId, email: actor.email }, license as string)
  return answer(versionId)
}

/** The author's consent to a listing an admin asked for, under a license. */
export async function cosignListing(versionId: string, actor: Person, license: string): Promise<ListingResult> {
  const row = await prisma.appToolVersion.findUnique({ where: { id: versionId }, select: VERSION_SELECT })
  if (!row) return { ok: false, status: 404, error: 'No such tool version.' }
  if (row.authorUserId !== actor.userId) return { ok: false, status: 403, error: 'Only the author of this version can co-sign its listing.' }
  if (listingRequestState(row) !== 'awaiting_cosign') {
    return { ok: false, status: 409, error: 'Nobody has asked to list this version, or it has moved on.' }
  }
  const parsed = parseLicense(license)
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error }
  return cosign(versionId, actor, parsed.license)
}

async function cosign(versionId: string, actor: Person, license: string): Promise<ListingResult> {
  const now = new Date()
  const row = await prisma.appToolVersion.update({
    where: { id: versionId },
    data: { cosignedBy: actor.userId, cosignedAt: now, license, marketplaceStatus: 'pending', marketplaceSubmittedAt: now },
    select: { name: true, version: true, sourceSpaceId: true, listingId: true },
  })
  if (row.listingId) {
    await prisma.appToolListing.update({ where: { id: row.listingId }, data: { authorUserId: actor.userId, license } })
  }
  await enqueueReview(versionId)
  void logAudit(row.sourceSpaceId, {
    userId: actor.userId,
    name: actor.email,
    action: 'tool',
    path: toolIndexPath(row.name),
    detail: `co-signed the listing of v${row.version} under ${license}`,
  })
  return answer(versionId)
}

/**
 * Take something back. A listing request (waiting on the author, or with
 * Visvine) by an admin of the space that wrote it or by its author; a version
 * still waiting on its own space's admins by its author.
 */
export async function withdrawListing(
  versionId: string,
  actor: Person & { spaceId?: string; isAdmin?: boolean },
): Promise<ListingResult> {
  const row = await prisma.appToolVersion.findUnique({ where: { id: versionId }, select: VERSION_SELECT })
  if (!row) return { ok: false, status: 404, error: 'No such tool version.' }
  const state = listingRequestState(row)
  const author = row.authorUserId === actor.userId
  const admin =
    actor.spaceId === row.sourceSpaceId && actor.isAdmin
      ? true
      : await isAdmin(actor.userId, row.sourceSpaceId, actor.email).catch(() => false)

  if (state === 'none' && row.status === 'pending') {
    const taken = await withdrawVersion(versionId, actor.userId)
    return taken.ok ? answer(versionId) : taken
  }
  if (state !== 'awaiting_cosign' && state !== 'in_review') {
    return { ok: false, status: 409, error: 'There is nothing waiting to withdraw on this version.' }
  }
  if (!author && !admin) {
    return { ok: false, status: 403, error: 'Only its author or an admin of the space that wrote it can withdraw this.' }
  }
  await prisma.$transaction([
    prisma.appToolVersion.update({
      where: { id: versionId },
      data:
        state === 'in_review'
          ? { marketplaceStatus: 'withdrawn', marketplaceReviewedAt: new Date() }
          : { listingRequestedAt: null, listingRequestedBy: null },
    }),
    prisma.appToolReviewRun.updateMany({ where: { versionId, status: 'queued' }, data: { status: 'error', error: 'Withdrawn.' } }),
  ])
  void logAudit(row.sourceSpaceId, {
    userId: actor.userId,
    name: actor.email,
    action: 'tool',
    path: toolIndexPath(row.name),
    detail: `withdrew the listing request for v${row.version}`,
  })
  return answer(versionId)
}

// ── once listed ──────────────────────────────────────────────────────────────

/**
 * What listing a version does to its listing row: the first listing sets when
 * it was listed and the stage it starts in; every listing records the license
 * and author it went out under.
 */
export async function markListed(versionId: string, now: Date = new Date()): Promise<void> {
  const row = await prisma.appToolVersion.findUnique({
    where: { id: versionId },
    select: { listingId: true, license: true, cosignedBy: true, authorUserId: true, sourceSpaceId: true },
  })
  if (!row?.listingId) return
  const listing = await prisma.appToolListing.findUnique({
    where: { id: row.listingId },
    select: { listedAt: true, verified: true, publisherSpaceId: true },
  })
  if (!listing) return
  const first = !listing.listedAt
  const earlier = first
    ? await prisma.appToolListing.count({ where: { publisherSpaceId: listing.publisherSpaceId, listedAt: { not: null } } })
    : 0
  const stage = first ? initialStage({ verified: listing.verified, publisherListings: earlier, now }) : null
  await prisma.appToolListing.update({
    where: { id: row.listingId },
    data: {
      ...(first ? { listedAt: now, stagedUntil: stage?.stagedUntil ?? null, stagedCap: stage?.stagedCap ?? null } : {}),
      ...(row.license ? { license: row.license } : {}),
      authorUserId: row.cosignedBy ?? row.authorUserId,
    },
  })
}

/** The spaces outside a listing's publisher that run it now. */
async function spacesRunning(listingId: string, publisherSpaceId: string, except?: string): Promise<number> {
  const rows = await prisma.appToolInstall.findMany({
    where: { listingId, spaceId: { not: publisherSpaceId }, sharedFromSpaceId: null, ...(except ? { NOT: { spaceId: except } } : {}) },
    select: { spaceId: true },
    distinct: ['spaceId'],
  })
  return rows.length
}

/** Why one more space may not install a staged listing now, or null. */
export async function stagedInstallRefusal(listingId: string, spaceId: string, now: Date = new Date()): Promise<string | null> {
  const listing = await prisma.appToolListing.findUnique({
    where: { id: listingId },
    select: { stagedUntil: true, stagedCap: true, publisherSpaceId: true },
  })
  if (!listing || listing.publisherSpaceId === spaceId) return null
  const spaces = await spacesRunning(listingId, listing.publisherSpaceId, spaceId)
  return stagedInstallDenial({ listing, spaces, now })
}

/** Visvine's word on a publisher, for one listing. Reviewers only. */
export async function setListingVerified(listingId: string, reviewer: Person, verified: boolean): Promise<{ ok: true } | RegistryError> {
  if (!isSuperAdmin(reviewer.email)) return { ok: false, status: 403, error: 'Only Visvine reviewers can verify a publisher.' }
  const row = await prisma.appToolListing.findUnique({ where: { id: listingId }, select: { publisherSpaceId: true, key: true } })
  if (!row) return { ok: false, status: 404, error: 'No such listing.' }
  await prisma.appToolListing.update({
    where: { id: listingId },
    // A verified publisher's listing is out of its stage.
    data: { verified, ...(verified ? { stagedUntil: null } : {}) },
  })
  void logAudit(row.publisherSpaceId, {
    userId: reviewer.userId,
    name: reviewer.email,
    action: 'tool',
    path: toolIndexPath(row.key.slice(row.key.indexOf('/') + 1)),
    detail: verified ? 'publisher verified by Visvine' : 'publisher no longer verified',
  })
  return { ok: true }
}

// ── transfer ─────────────────────────────────────────────────────────────────

export type TransferResult = { ok: true; listingId: string; key: string; transferTo: string | null } | RegistryError

/** The listing a version of a Tool belongs to, found by the version's id or the Tool's key. */
async function findListing(ref: { listingId?: string; key?: string }) {
  if (!ref.listingId && !ref.key) return null
  return prisma.appToolListing.findFirst({
    where: ref.listingId ? { id: ref.listingId } : { key: ref.key },
    select: { id: true, key: true, publisherSpaceId: true, state: true, transferTo: true, listedAt: true },
  })
}

/** The publisher's admins offering their listing to another space. `toSpaceId` null takes an offer back. */
export async function offerTransfer(
  ref: { listingId?: string; key?: string },
  actor: Admin,
  toSpaceId: string | null,
): Promise<TransferResult> {
  const listing = await findListing(ref)
  if (!listing) return { ok: false, status: 404, error: 'No such listing.' }
  if (listing.publisherSpaceId !== actor.spaceId || !actor.isAdmin) {
    return { ok: false, status: 403, error: 'Only an admin of the publishing space can transfer its listing.' }
  }
  if (decodeListingState(listing.state) === 'revoked') return { ok: false, status: 409, error: 'Visvine removed this listing for good.' }
  if (!listing.listedAt) return { ok: false, status: 409, error: 'Only a listed tool can be transferred.' }
  if (toSpaceId === listing.publisherSpaceId) return { ok: false, status: 400, error: 'That space already publishes it.' }
  if (toSpaceId && !(await prisma.space.findUnique({ where: { id: toSpaceId }, select: { id: true } }))) {
    return { ok: false, status: 404, error: 'No such space.' }
  }
  await prisma.appToolListing.update({
    where: { id: listing.id },
    data: { transferTo: toSpaceId, transferBy: toSpaceId ? actor.userId : null, transferAt: toSpaceId ? new Date() : null },
  })
  void logAudit(listing.publisherSpaceId, {
    userId: actor.userId,
    name: actor.email,
    action: 'tool',
    path: toolIndexPath(listing.key.slice(listing.key.indexOf('/') + 1)),
    detail: toSpaceId ? `offered the listing to ${toSpaceId}` : 'took back the listing transfer offer',
  })
  return { ok: true, listingId: listing.id, key: listing.key, transferTo: toSpaceId }
}

/**
 * The receiving space's admins answering an offer. Accepting names the Tool
 * in THIS space that carries the listing on — a working copy, usually an
 * import of the listed version — and from then on the listing is theirs: the
 * next version they list is offered to every install.
 */
export async function answerTransfer(
  listingId: string,
  actor: Admin,
  decision: { accept: boolean; name?: string },
): Promise<TransferResult> {
  const listing = await findListing({ listingId })
  if (!listing) return { ok: false, status: 404, error: 'No such listing.' }
  if (listing.transferTo !== actor.spaceId || !actor.isAdmin) {
    return { ok: false, status: 403, error: 'Only an admin of the space it was offered to can answer.' }
  }
  const oldName = listing.key.slice(listing.key.indexOf('/') + 1)
  if (!decision.accept) {
    await prisma.appToolListing.update({ where: { id: listing.id }, data: { transferTo: null, transferBy: null, transferAt: null } })
    void logAudit(listing.publisherSpaceId, {
      userId: actor.userId,
      name: actor.email,
      action: 'tool',
      path: toolIndexPath(oldName),
      detail: `${actor.spaceId} declined the listing transfer`,
    })
    return { ok: true, listingId: listing.id, key: listing.key, transferTo: null }
  }
  const name = decision.name?.trim() || oldName
  const hasTool = await prisma.appToolBuild.findUnique({
    where: { app_tool_build_identity: { spaceId: actor.spaceId, name } },
    select: { id: true },
  })
  if (!hasTool) {
    return { ok: false, status: 409, error: `This space has no tool named ${name} to carry the listing — import it first.` }
  }
  const key = toolKey(actor.spaceId, name)
  const clash = await prisma.appToolListing.findUnique({ where: { key }, select: { id: true } })
  if (clash && clash.id !== listing.id) return { ok: false, status: 409, error: `${name} here already has a listing of its own.` }
  const from = listing.publisherSpaceId
  await prisma.appToolListing.update({
    where: { id: listing.id },
    data: { key, publisherSpaceId: actor.spaceId, transferTo: null, transferBy: null, transferAt: null, verified: false },
  })
  for (const [spaceId, detail] of [
    [from, `transferred the listing to ${actor.spaceId}`],
    [actor.spaceId, `took over the listing of ${listing.key}`],
  ] as const) {
    void logAudit(spaceId, { userId: actor.userId, name: actor.email, action: 'tool', path: toolIndexPath(spaceId === from ? oldName : name), detail })
  }
  return { ok: true, listingId: listing.id, key, transferTo: null }
}
