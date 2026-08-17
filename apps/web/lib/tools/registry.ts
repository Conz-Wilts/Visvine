/**
 * The Tool marketplace registry — publish, review, browse.
 *
 * One row per published version (`AppToolVersion`), keyed `<spaceId>/<name>` and
 * numbered from 1. Publishing snapshots EVERYTHING the running Tool is made of
 * (config, perimeter, the three sources, both compiled bundles) into that row
 * and queues it for a Visvine super-admin. Once approved a version never
 * changes: an upgrade is a new row, and an install pins the id it chose, so code
 * can never change under a space silently. That immutability is the whole point
 * of the table, which is why nothing here updates a snapshot field — only
 * `status` and the three review columns beside it ever move.
 *
 * Where the boundaries are:
 *   • Publishing is a SPACE admin act, over that space's own working copy
 *     (`AppToolBuild`, written by the compile-on-write hook).
 *   • Reviewing is a VISVINE super-admin act (`isSuperAdmin` — env-driven), and
 *     the queue is global: this is the one table in the app that is not
 *     space-scoped.
 *   • Installing is a space admin act and lives next door in ./installs.ts,
 *     which reads versions through here.
 *
 * The decision logic worth testing without a database is `nextVersionNumber`;
 * everything else is a thin read or write. Refusals come back as
 * `{ ok: false, status, error }` rather than exceptions, matching
 * lib/agents/service.ts — a route can hand the pair straight to the client.
 */
import prisma from '@/lib/prisma'
import { isSuperAdmin } from '@/lib/session'
import { writeGated } from '@/lib/notes/contextService'
import { principalIsSuperAdmin } from '@/lib/notes/shared/permissions'
import { splitFrontmatter } from '@/lib/notes/shared/markdown'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import type { Context } from '@/lib/notes/store'
import { getBuild, readToolSources, toBuildSummary, toolDiagnosticLine } from './builds'
import {
  TOOL_NAME_RE,
  toolIndexPath,
  unwrapSource,
  type ToolConfig,
  type ToolTypeSurface,
} from './config'
import {
  diffPerimeter,
  EMPTY_PERIMETER,
  type PerimeterDiff,
  type ToolPerimeter,
} from './perimeter'

/**
 * Where a version stands. `pending` is in the queue, `approved` is installable,
 * `rejected` was refused by a reviewer and `withdrawn` was taken back by its
 * author before anyone looked. Only `approved` is ever installed, and a
 * rejection is kept rather than deleted so the author can read the note.
 */
export type ToolVersionStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn'

const STATUSES: readonly ToolVersionStatus[] = ['pending', 'approved', 'rejected', 'withdrawn']

/** A refusal, carrying the HTTP status the REST layer should answer with. */
export interface RegistryError {
  ok: false
  status: number
  error: string
}

/** What the marketplace and the review queue list. Never the bundles: they are
 *  megabytes of compiled ESM the runtime route loads on its own. */
export interface ToolVersionSummary {
  id: string
  /** `<sourceSpaceId>/<name>` — stable across versions, and the install's key. */
  key: string
  name: string
  version: number
  title: string
  description: string | null
  status: ToolVersionStatus
  submittedAt: string
  reviewedAt: string | null
  reviewNote: string | null
  sizeBytes: number
  sourceSpaceId: string
  /** Display name of whoever published it; null if the account is gone. */
  author: { userId: string | null; name: string | null }
  perimeter: ToolPerimeter
  /** Rail row and type claims the Tool asks for, for the marketplace card. */
  surfaces: { rail: { label: string; icon: string } | null; types: ToolTypeSurface[] }
}

/** A version opened: the summary plus everything a reviewer or a diff reads. */
export interface ToolVersionDetail extends ToolVersionSummary {
  config: ToolConfig
  /** The index note's BODY at publish time — the Tool's docs, no frontmatter. */
  indexSource: string
  uiSource: string
  dataSource: string
}

/** A marketplace row: the latest approved version of one Tool, plus its reach. */
export interface BrowseEntry extends ToolVersionSummary {
  installs: number
}

export interface BrowsePage {
  items: BrowseEntry[]
  /** Pass back as `cursor` for the next page; null when this was the last. */
  nextCursor: string | null
}

export type PublishResult =
  | {
      ok: true
      version: ToolVersionSummary
      /** Set when the registry row landed but the note's `version:` bump didn't. */
      warning: string | null
    }
  | RegistryError

export type VersionResult = { ok: true; version: ToolVersionSummary } | RegistryError

export type ReviewResult =
  | {
      ok: true
      version: ToolVersionSummary
      /** Installs of older versions now offered this one as an upgrade. */
      upgraded: number
    }
  | RegistryError

/** How many rows one browse page holds. */
const BROWSE_PAGE = 24

// ── decoding stored JSON ──────────────────────────────────────────────────────

function stringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
}

/**
 * The `perimeter` JSON column → a perimeter. A cast would be shorter, but this
 * column feeds the bridge's refusals: a row missing a key must read as "declares
 * nothing" (deny) rather than `undefined.some` inside a gate.
 */
export function decodeToolPerimeter(raw: unknown): ToolPerimeter {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  return {
    read: stringList(value.read),
    write: stringList(value.write),
    types: stringList(value.types),
    connectors: stringList(value.connectors),
    agents: stringList(value.agents),
  }
}

function decodeRail(raw: unknown): { label: string; icon: string } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const rail = raw as Record<string, unknown>
  const label = typeof rail.label === 'string' ? rail.label : ''
  const icon = typeof rail.icon === 'string' ? rail.icon : ''
  if (!label || !icon) return null
  return { label, icon }
}

function decodeTypeSurfaces(raw: unknown): ToolTypeSurface[] {
  if (!Array.isArray(raw)) return []
  const out: ToolTypeSurface[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const claim = entry as Record<string, unknown>
    const type = typeof claim.type === 'string' ? claim.type.trim().toLowerCase() : ''
    if (!type) continue
    out.push({ type, mode: claim.mode === 'page' ? 'page' : 'tab' })
  }
  return out
}

/**
 * The `config` JSON column → a ToolConfig. Written by parseToolConfig, so the
 * shape is known; decoded defensively all the same, for the same reason as the
 * perimeter — a snapshot from an older shape must still render its card.
 */
export function decodeToolConfig(raw: unknown, name: string): ToolConfig {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const surfaces =
    value.surfaces && typeof value.surfaces === 'object' && !Array.isArray(value.surfaces)
      ? (value.surfaces as Record<string, unknown>)
      : {}
  return {
    name: typeof value.name === 'string' && value.name ? value.name : name,
    title: typeof value.title === 'string' && value.title ? value.title : name,
    description: typeof value.description === 'string' ? value.description : '',
    version: typeof value.version === 'number' && Number.isInteger(value.version) ? value.version : 0,
    surfaces: { rail: decodeRail(surfaces.rail), types: decodeTypeSurfaces(surfaces.types) },
    perimeter: decodeToolPerimeter(value.perimeter),
  }
}

function decodeStatus(raw: string): ToolVersionStatus {
  return (STATUSES as readonly string[]).includes(raw) ? (raw as ToolVersionStatus) : 'pending'
}

// ── row → DTO ────────────────────────────────────────────────────────────────

/** Every column a summary needs, and none of the heavy ones. */
const SUMMARY_SELECT = {
  id: true,
  key: true,
  name: true,
  version: true,
  title: true,
  description: true,
  status: true,
  submittedAt: true,
  reviewedAt: true,
  reviewNote: true,
  sizeBytes: true,
  sourceSpaceId: true,
  authorUserId: true,
  config: true,
  perimeter: true,
  author: { select: { id: true, name: true } },
} as const

const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  indexSource: true,
  uiSource: true,
  dataSource: true,
} as const

type SummaryRow = {
  id: string
  key: string
  name: string
  version: number
  title: string
  description: string | null
  status: string
  submittedAt: Date
  reviewedAt: Date | null
  reviewNote: string | null
  sizeBytes: number
  sourceSpaceId: string
  authorUserId: string | null
  config: unknown
  perimeter: unknown
  author: { id: string; name: string } | null
}

type DetailRow = SummaryRow & { indexSource: string; uiSource: string; dataSource: string }

function toSummary(row: SummaryRow): ToolVersionSummary {
  const config = decodeToolConfig(row.config, row.name)
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    version: row.version,
    title: row.title,
    description: row.description,
    status: decodeStatus(row.status),
    submittedAt: row.submittedAt.toISOString(),
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    reviewNote: row.reviewNote,
    sizeBytes: row.sizeBytes,
    sourceSpaceId: row.sourceSpaceId,
    author: { userId: row.authorUserId, name: row.author?.name ?? null },
    // The perimeter column is authoritative for the reach shown at review and
    // install time; config.perimeter is the same thing inside the snapshot.
    perimeter: decodeToolPerimeter(row.perimeter),
    surfaces: config.surfaces,
  }
}

function toDetail(row: DetailRow): ToolVersionDetail {
  return {
    ...toSummary(row),
    config: decodeToolConfig(row.config, row.name),
    indexSource: row.indexSource,
    uiSource: row.uiSource,
    dataSource: row.dataSource,
  }
}

// ── version numbering (pure) ─────────────────────────────────────────────────

/**
 * The number the next publish of a Tool gets: one past the highest that key has
 * ever had, counting from 1.
 *
 * The highest EVER, not the highest approved — a rejected or withdrawn version 3
 * still burns the number, because `(key, version)` is unique and because "version
 * 3" naming two different snapshots is exactly the confusion an immutable
 * registry exists to prevent.
 */
export function nextVersionNumber(existing: readonly number[]): number {
  let highest = 0
  for (const version of existing) {
    if (Number.isInteger(version) && version > highest) highest = version
  }
  return highest + 1
}

/** `<spaceId>/<name>` — the marketplace identity of a Tool, across versions. */
export function toolKey(spaceId: string, name: string): string {
  return `${spaceId}/${name}`
}

// ── publish ──────────────────────────────────────────────────────────────────

/**
 * Rewrite the top-level `version:` line of an index note in place.
 *
 * A line edit rather than a frontmatter round trip: `joinFrontmatter` would
 * re-serialize the whole block, reordering keys and requoting strings the author
 * wrote by hand. Only a column-0 `version:` matches, so a `version:` nested
 * inside `surfaces:` or `perimeter:` is left alone.
 */
function bumpIndexVersion(markdown: string, version: number): string | null {
  const { frontmatter, body } = splitFrontmatter(markdown)
  if (frontmatter === null) return null
  const lines = frontmatter.split('\n')
  const at = lines.findIndex((line) => /^version\s*:/.test(line))
  if (at === -1) lines.push(`version: ${version}`)
  else lines[at] = `version: ${version}`
  return `---\n${lines.join('\n')}\n---\n\n${body}`
}

/**
 * Publish the space's working copy of one Tool as the next version, pending
 * review.
 *
 * Refuses unless the working copy compiles: the registry stores bundles, and a
 * broken snapshot would be a Tool that installs and then renders an error card
 * in somebody else's space. Refuses a second pending version for the same key —
 * a reviewer looking at two snapshots of "the same" Tool is being asked the
 * wrong question, and the author can withdraw the first.
 *
 * The `version:` bump in the index note is a courtesy write, not part of the
 * publish: the registry row is authoritative, and a denied write (a frozen
 * folder, a publication replica) comes back as a warning rather than undoing a
 * version that already exists.
 *
 * Takes the space from `context.spaceId` rather than a separate argument, so the
 * principal, the context and the key can never disagree.
 */
export async function publishTool(
  p: ContextPrincipal,
  context: Context,
  name: string,
  opts: { note?: string } = {},
): Promise<PublishResult> {
  if (!principalIsSuperAdmin(p)) {
    return { ok: false, status: 403, error: 'Only space admins can publish a tool.' }
  }
  if (!TOOL_NAME_RE.test(name)) return { ok: false, status: 400, error: 'Bad tool name.' }

  const spaceId = context.spaceId
  const buildRow = await getBuild(spaceId, name)
  if (!buildRow) {
    return {
      ok: false,
      status: 404,
      error: `${name} has never been compiled here — save the tool once, then publish.`,
    }
  }
  const build = toBuildSummary(buildRow)
  if (build.configError || !build.config) {
    return {
      ok: false,
      status: 400,
      error: `The tool's index note is invalid: ${build.configError ?? 'it has no readable config'}`,
    }
  }
  if (!build.ok || buildRow.uiBundle === null) {
    const first = build.errors[0]
    const detail = first ? ` (${toolDiagnosticLine(first)})` : ''
    return { ok: false, status: 400, error: `${name} does not compile${detail} — fix it and publish again.` }
  }

  // The sources as the compiler read them — publishing is admin-only, and an
  // admin's visibility lens is the whole space, so this is the same three notes
  // the build was made from rather than a second, possibly narrower, reading.
  const indexPath = toolIndexPath(name)
  const sources = await readToolSources(spaceId, name)
  if (sources.index === null) return { ok: false, status: 404, error: `No tool note at ${indexPath}.` }
  if (sources.ui === null) {
    return { ok: false, status: 400, error: `${name} has no ui.tsx — a tool must have something to render.` }
  }
  const indexNote = sources.index

  const config = build.config
  const key = toolKey(spaceId, name)
  const created = await prisma.$transaction(async (tx) => {
    // Serialize publishes of one key: the pending check and the number it picks
    // are one decision, and two concurrent publishes would otherwise both pass
    // the check and queue two snapshots. Same advisory-lock pattern as
    // lib/spaces/spaceConfig.ts#updateSpaceConfig.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`app_tool:${key}`})::bigint)::text`
    const existing = await tx.appToolVersion.findMany({
      where: { key },
      select: { version: true, status: true },
    })
    if (existing.some((row) => row.status === 'pending')) return null
    const row = await tx.appToolVersion.create({
      data: {
        key,
        name,
        version: nextVersionNumber(existing.map((row) => row.version)),
        title: config.title,
        description: config.description || null,
        authorUserId: p.userId,
        sourceSpaceId: spaceId,
        config: config as unknown as object,
        perimeter: config.perimeter as unknown as object,
        indexSource: splitFrontmatter(indexNote).body,
        uiSource: unwrapSource(sources.ui ?? '')?.code ?? '',
        dataSource: sources.data ? (unwrapSource(sources.data)?.code ?? '') : '',
        uiBundle: buildRow.uiBundle ?? '',
        dataBundle: buildRow.dataBundle ?? '',
        sizeBytes: build.sizeBytes,
        reviewNote: opts.note?.trim() ? opts.note.trim() : null,
      },
      select: SUMMARY_SELECT,
    })
    return row
  })
  if (!created) {
    return {
      ok: false,
      status: 409,
      error: `${name} already has a version awaiting review — withdraw it before publishing again.`,
    }
  }

  // Human origin on purpose: a person pressed Publish. 'agent'/'maintenance'
  // would hit the tools/ AI freeze in contextService.lockedDenial.
  const bumped = bumpIndexVersion(indexNote, created.version)
  let warning: string | null = null
  if (bumped === null) {
    warning = `Published as version ${created.version}, but ${indexPath} has no frontmatter to record it in.`
  } else {
    const written = await writeGated(p, context, indexPath, bumped, 'edit')
    if (written.status === 'denied') {
      warning = `Published as version ${created.version}, but ${indexPath} could not be updated: ${written.reason}`
    }
  }
  return { ok: true, version: toSummary(created), warning }
}

/** An author taking back a version nobody has reviewed yet. */
export async function withdrawVersion(versionId: string, callerId: string): Promise<VersionResult> {
  const row = await prisma.appToolVersion.findUnique({
    where: { id: versionId },
    select: { id: true, status: true, authorUserId: true },
  })
  if (!row) return { ok: false, status: 404, error: 'No such tool version.' }
  if (row.authorUserId !== callerId) {
    return { ok: false, status: 403, error: 'Only the author can withdraw a submission.' }
  }
  if (row.status !== 'pending') {
    return { ok: false, status: 409, error: `This version is already ${row.status}.` }
  }
  const updated = await prisma.appToolVersion.update({
    where: { id: versionId },
    data: { status: 'withdrawn' },
    select: SUMMARY_SELECT,
  })
  return { ok: true, version: toSummary(updated) }
}

// ── review (super-admin) ─────────────────────────────────────────────────────

/** Everything awaiting review, oldest submission first — a queue, not a feed. */
export async function listReviewQueue(): Promise<ToolVersionSummary[]> {
  const rows = await prisma.appToolVersion.findMany({
    where: { status: 'pending' },
    orderBy: { submittedAt: 'asc' },
    select: SUMMARY_SELECT,
  })
  return rows.map(toSummary)
}

/**
 * A Visvine super-admin's verdict on one pending version.
 *
 * Approving does one more thing than flipping the status: every install of the
 * same Tool pinned to an OLDER version is marked with this id as its
 * `pendingVersionId`. That is the "an upgrade is available" flag — an admin in
 * that space still has to apply it (lib/tools/installs.ts#applyUpgrade) after
 * reading the perimeter diff, so approving never changes code under anyone.
 */
export async function reviewVersion(
  versionId: string,
  decision: 'approved' | 'rejected',
  reviewer: { userId: string; email: string },
  note?: string,
): Promise<ReviewResult> {
  if (!isSuperAdmin(reviewer.email)) {
    return { ok: false, status: 403, error: 'Only Visvine super admins can review tool submissions.' }
  }
  if (decision !== 'approved' && decision !== 'rejected') {
    return { ok: false, status: 400, error: 'A review is either approved or rejected.' }
  }
  const row = await prisma.appToolVersion.findUnique({
    where: { id: versionId },
    select: { id: true, key: true, version: true, status: true },
  })
  if (!row) return { ok: false, status: 404, error: 'No such tool version.' }
  if (row.status !== 'pending') {
    return { ok: false, status: 409, error: `This version is already ${row.status}.` }
  }

  const updated = await prisma.appToolVersion.update({
    where: { id: versionId },
    data: {
      status: decision,
      reviewedBy: reviewer.userId,
      reviewedAt: new Date(),
      reviewNote: note?.trim() ? note.trim() : null,
    },
    select: SUMMARY_SELECT,
  })

  let upgraded = 0
  if (decision === 'approved') {
    // AppToolInstall pins a version by id, not by number, so "older than this"
    // is a question about the joined row.
    const installs = await prisma.appToolInstall.findMany({
      where: { key: row.key },
      select: { id: true, version: { select: { version: true } } },
    })
    const stale = installs.filter((install) => install.version.version < row.version).map((i) => i.id)
    if (stale.length > 0) {
      const result = await prisma.appToolInstall.updateMany({
        where: { id: { in: stale } },
        data: { pendingVersionId: versionId },
      })
      upgraded = result.count
    }
  }
  return { ok: true, version: toSummary(updated), upgraded }
}

// ── browse and history ───────────────────────────────────────────────────────

/**
 * The marketplace listing: the newest APPROVED version of each Tool, newest
 * publication first, with the author's name and how many spaces run it.
 *
 * Folded in memory rather than with a `DISTINCT ON` query. The registry is
 * review-gated and free, so "every approved version ever" is a small set, and
 * the alternative is raw SQL that has to be kept in step with the search filter.
 * The cursor is the last key returned, which is stable because keys are unique
 * within the folded page.
 */
export async function browseVersions(
  opts: { q?: string; cursor?: string; limit?: number } = {},
): Promise<BrowsePage> {
  const q = opts.q?.trim() ?? ''
  const rows = await prisma.appToolVersion.findMany({
    where: {
      status: 'approved',
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: 'insensitive' as const } },
              { name: { contains: q, mode: 'insensitive' as const } },
              { description: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    orderBy: [{ key: 'asc' }, { version: 'desc' }],
    select: SUMMARY_SELECT,
  })

  const latest: SummaryRow[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (seen.has(row.key)) continue
    seen.add(row.key)
    latest.push(row)
  }
  latest.sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime() || a.key.localeCompare(b.key))

  const start = opts.cursor ? latest.findIndex((row) => row.key === opts.cursor) + 1 : 0
  const limit = Math.max(1, Math.min(opts.limit ?? BROWSE_PAGE, 100))
  const page = latest.slice(start, start + limit)

  const counts = page.length
    ? await prisma.appToolInstall.groupBy({
        by: ['key'],
        where: { key: { in: page.map((row) => row.key) } },
        _count: { _all: true },
      })
    : []
  const byKey = new Map(counts.map((row) => [row.key, row._count._all]))

  return {
    items: page.map((row) => ({ ...toSummary(row), installs: byKey.get(row.key) ?? 0 })),
    nextCursor: start + limit < latest.length ? (page[page.length - 1]?.key ?? null) : null,
  }
}

/** One version, opened: config, perimeter and all three sources. */
export async function getVersion(id: string): Promise<ToolVersionDetail | null> {
  const row = await prisma.appToolVersion.findUnique({ where: { id }, select: DETAIL_SELECT })
  return row ? toDetail(row) : null
}

/** Every version of one Tool, newest first — the author's and reviewer's trail. */
export async function versionHistory(key: string): Promise<ToolVersionSummary[]> {
  const rows = await prisma.appToolVersion.findMany({
    where: { key },
    orderBy: { version: 'desc' },
    select: SUMMARY_SELECT,
  })
  return rows.map(toSummary)
}

/**
 * The approved version a reviewer should diff against: the highest approved one
 * BELOW this number. Null for a first submission, and null when every earlier
 * version was rejected — a reviewer comparing against something nobody approved
 * would be reading a diff of two unshipped things.
 */
export async function previousApprovedVersion(
  key: string,
  before: number,
): Promise<ToolVersionDetail | null> {
  const row = await prisma.appToolVersion.findFirst({
    where: { key, status: 'approved', version: { lt: before } },
    orderBy: { version: 'desc' },
    select: DETAIL_SELECT,
  })
  return row ? toDetail(row) : null
}

/**
 * What this version's declared reach adds or drops against the last approved
 * one — the question a reviewer is really being asked. A first submission diffs
 * against EMPTY_PERIMETER, so everything it wants reads as added.
 */
export async function perimeterDiffForVersion(versionId: string): Promise<{
  previous: { id: string; version: number } | null
  diff: PerimeterDiff
} | null> {
  const row = await prisma.appToolVersion.findUnique({
    where: { id: versionId },
    select: { key: true, version: true, perimeter: true },
  })
  if (!row) return null
  const previous = await previousApprovedVersion(row.key, row.version)
  return {
    previous: previous ? { id: previous.id, version: previous.version } : null,
    diff: diffPerimeter(previous?.perimeter ?? EMPTY_PERIMETER, decodeToolPerimeter(row.perimeter)),
  }
}
