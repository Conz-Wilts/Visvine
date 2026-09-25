/**
 * The Tool version registry — publish, approve, list, browse.
 *
 * One row per published version (`AppToolVersion`), keyed `<spaceId>/<name>` and
 * numbered from 1. Publishing snapshots EVERYTHING the running Tool is made of
 * (config, perimeter, the three sources, both compiled bundles) into that row.
 * Once written a version never changes: an upgrade is a new row, and an install
 * pins the id it chose, so code can never change under a space silently. That
 * immutability is the whole point of the table, which is why nothing here
 * updates a snapshot field — only the two verdicts and their review columns
 * ever move.
 *
 * TWO VERDICTS, because a Tool being ready and a Tool being public are two
 * different questions and only the first one is asked by default:
 *
 *   status              the SOURCE SPACE's. An admin publishing approves as they
 *                       publish; a member publishing queues for their admins
 *                       (`reviewSpaceVersion`). `approved` is what makes a
 *                       version installable — in that space itself and nowhere
 *                       else.
 *   marketplaceStatus   VISVINE's, and NULL until an admin explicitly calls
 *                       for a listing (lib/tools/listings.ts#requestListing)
 *                       and its author co-signs. Only `approved` there lists a
 *                       version on the global shelf or lets an unrelated space
 *                       install it (`reviewVersion`, super-admin).
 *
 * So a Tool written in a private space stays in it. Publishing ships it to the
 * people who wrote it; going public is a second act, taken deliberately, and
 * reviewed by someone else.
 *
 * Where the boundaries are:
 *   • Publishing is a MEMBER act over that space's own working copy
 *     (`AppToolBuild`, written by the compile-on-write hook); approving it is
 *     the space admin's.
 *   • Marketplace review is a VISVINE super-admin act (`isSuperAdmin` —
 *     env-driven), and that queue is the one global surface here.
 *   • Installing is a space admin act and lives next door in ./installs.ts,
 *     which reads versions through here.
 *
 * The decision logic worth testing without a database is `nextVersionNumber`,
 * `installability` and `shouldAutoApprove`; everything else is a thin read or
 * write. Refusals come back as `{ ok: false, status, error }` rather than
 * exceptions, matching lib/agents/service.ts — a route can hand the pair
 * straight to the client.
 */
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { isSuperAdmin } from '@/lib/session'
import { logAudit } from '@/lib/notes/audit'
import { readVisible, writeGated } from '@/lib/notes/contextService'
import { principalCanWrite, principalIsSuperAdmin } from '@/lib/notes/shared/permissions'
import { splitFrontmatter } from '@/lib/notes/shared/markdown'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import type { Context } from '@/lib/notes/store'
import { toolFolderIn } from './location'
import {
  getBuild,
  readToolSources,
  toBuildSummary,
  toolDiagnosticLine,
  toolSourceHash,
} from './builds'
import {
  manifestOf,
  TOOL_NAME_RE,
  parseToolBandActions,
  parseToolNav,
  parseToolPreviewUrl,
  parseToolTags,
  toolIndexPath,
  unwrapSource,
  toolModuleFileOf,
  type ToolConfig,
  type ToolTypeSurface,
} from './config'
import {
  diffPerimeter,
  EMPTY_PERIMETER,
  type PerimeterDiff,
  type ToolPerimeter,
} from './perimeter'
import { type ListingState } from './verdicts'
import { listingRequestState, type ListingRequestState } from './shared/listing'
import { runStaticChecks, type StaticCheckInput } from './checks/analyze'
import { parseManifestFacts, type ToolManifestFacts } from '@visvine/tool-protocol/manifest'
import { blockingFindings, findingLine, reportStatus, type CheckFinding, type CheckReport } from './checks/findings'
import { recordReport, versionReports } from './checks/runs'
import { diffManifest } from './manifestDiff'

/**
 * Where a verdict stands. `pending` is in a queue, `approved` is the yes,
 * `rejected` was refused and `withdrawn` was taken back before anyone looked.
 * Both verdicts use it: `status` is the source space's, `marketplaceStatus` is
 * Visvine's. A rejection is kept rather than deleted so the author can read the
 * note that came with it.
 */
export type ToolVersionStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn'

const STATUSES: readonly ToolVersionStatus[] = ['pending', 'approved', 'rejected', 'withdrawn']

/**
 * Visvine's verdict on a global listing, or null while nobody has asked for
 * one. Null is the state every version starts in and most versions stay in.
 */
export type MarketplaceStatus = ToolVersionStatus | null

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
  /** The source space's verdict — what decides whether this can be installed. */
  status: ToolVersionStatus
  submittedAt: string
  reviewedAt: string | null
  reviewNote: string | null
  /** Visvine's verdict on a global listing; null = never submitted for one. */
  marketplaceStatus: MarketplaceStatus
  marketplaceSubmittedAt: string | null
  marketplaceReviewedAt: string | null
  marketplaceReviewNote: string | null
  sizeBytes: number
  sourceSpaceId: string
  /** Display name of whoever published it; null if the account is gone. */
  author: { userId: string | null; name: string | null }
  perimeter: ToolPerimeter
  /** Rail row and type claims the Tool asks for, for the marketplace card. */
  surfaces: { rail: { label: string; icon: string } | null; types: ToolTypeSurface[] }
  /** The version's manifest facts: its reach in the abstract, its binding slots, its settings. */
  manifest: ToolManifestFacts
  /**
   * The Tool's own rail glyph when it ships one (`rail.icon: custom`), already
   * sanitized at build time. Null means it picked a built-in shape.
   */
  iconSvg: string | null
  /** The author's own "what changed" for this version, or null. */
  releaseNotes: string | null
  /** `tags:` from index.md at publish time — marketplace facets. */
  tags: string[]
  /** `preview:` from index.md at publish time — a card image, or null. */
  previewUrl: string | null
  /** Set when the version was withdrawn after approval (lib/tools/verdicts.ts). */
  revokedAt: string | null
  revokeReason: string | null
  /** The global listing it was offered under, and where that offer stands (lib/tools/listings.ts). */
  listingId: string | null
  listingState: ListingRequestState
  listingRequestedAt: string | null
  cosignedAt: string | null
  /** The license its author co-signed under. */
  license: string | null
}

/** A version opened: the summary plus everything a reviewer or a diff reads. */
export interface ToolVersionDetail extends ToolVersionSummary {
  config: ToolConfig
  /** The index note's BODY at publish time — the Tool's docs, no frontmatter. */
  indexSource: string
  uiSource: string
  dataSource: string
  /** The interface's own modules, by file (`src/chart.tsx`). */
  modules: Record<string, string>
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
      /** The static checks it passed, as they are stored against the version. */
      report: CheckReport
    }
  | (RegistryError & { report?: CheckReport })

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
    surfaces: {
      rail: decodeRail(surfaces.rail),
      types: decodeTypeSurfaces(surfaces.types),
      nav: ((n) => (n.ok ? n.nav : null))(parseToolNav(surfaces.nav)),
      actions: ((a) => (a.ok ? a.actions : []))(parseToolBandActions(surfaces.actions)),
    },
    perimeter: decodeToolPerimeter(value.perimeter),
    ...(((m) => (m && m.ok ? { manifest: m.value } : {}))(
      value.manifest && typeof value.manifest === 'object' && !Array.isArray(value.manifest)
        ? parseManifestFacts(value.manifest as Record<string, unknown>)
        : null,
    )),
    tags: ((t) => (t.ok ? t.tags : []))(parseToolTags(value.tags)),
    previewUrl: ((p) => (p.ok ? p.previewUrl : null))(parseToolPreviewUrl(value.previewUrl)),
  }
}

/** A stored verdict string → a verdict. An unknown value reads as `pending`:
 *  the state that grants nothing. */
export function decodeVersionStatus(raw: string): ToolVersionStatus {
  return (STATUSES as readonly string[]).includes(raw) ? (raw as ToolVersionStatus) : 'pending'
}

const decodeStatus = decodeVersionStatus

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
  marketplaceStatus: true,
  marketplaceSubmittedAt: true,
  marketplaceReviewedAt: true,
  marketplaceReviewNote: true,
  sizeBytes: true,
  sourceSpaceId: true,
  authorUserId: true,
  config: true,
  perimeter: true,
  iconSvg: true,
  releaseNotes: true,
  tags: true,
  previewUrl: true,
  revokedAt: true,
  revokeReason: true,
  listingId: true,
  listingRequestedAt: true,
  cosignedAt: true,
  license: true,
  author: { select: { id: true, name: true } },
} as const

const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  indexSource: true,
  uiSource: true,
  dataSource: true,
  modules: true,
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
  marketplaceStatus: string | null
  marketplaceSubmittedAt: Date | null
  marketplaceReviewedAt: Date | null
  marketplaceReviewNote: string | null
  sizeBytes: number
  sourceSpaceId: string
  authorUserId: string | null
  config: unknown
  perimeter: unknown
  iconSvg: string | null
  releaseNotes: string | null
  tags: string[]
  previewUrl: string | null
  revokedAt: Date | null
  revokeReason: string | null
  listingId: string | null
  listingRequestedAt: Date | null
  cosignedAt: Date | null
  license: string | null
  author: { id: string; name: string } | null
}

type DetailRow = SummaryRow & { indexSource: string; uiSource: string; dataSource: string; modules: unknown }

/** A stored module map, text values only. */
function decodeModules(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

/** A Tool's module notes → its modules by file, unwrapped as the compiler reads them. */
function unwrapModules(notes: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [relative, note] of Object.entries(notes ?? {})) {
    const unwrapped = unwrapSource(note)
    const file = unwrapped ? toolModuleFileOf(relative, unwrapped.lang) : null
    if (unwrapped && file) out[file] = unwrapped.code
  }
  return out
}

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
    marketplaceStatus: row.marketplaceStatus ? decodeStatus(row.marketplaceStatus) : null,
    marketplaceSubmittedAt: row.marketplaceSubmittedAt ? row.marketplaceSubmittedAt.toISOString() : null,
    marketplaceReviewedAt: row.marketplaceReviewedAt ? row.marketplaceReviewedAt.toISOString() : null,
    marketplaceReviewNote: row.marketplaceReviewNote,
    sizeBytes: row.sizeBytes,
    sourceSpaceId: row.sourceSpaceId,
    author: { userId: row.authorUserId, name: row.author?.name ?? null },
    // The perimeter column is authoritative for the reach shown at review and
    // install time; config.perimeter is the same thing inside the snapshot.
    perimeter: decodeToolPerimeter(row.perimeter),
    surfaces: config.surfaces,
    manifest: manifestOf(config),
    iconSvg: row.iconSvg,
    releaseNotes: row.releaseNotes,
    tags: row.tags,
    previewUrl: row.previewUrl,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    revokeReason: row.revokeReason,
    listingId: row.listingId,
    listingState: listingRequestState(row),
    listingRequestedAt: row.listingRequestedAt ? row.listingRequestedAt.toISOString() : null,
    cosignedAt: row.cosignedAt ? row.cosignedAt.toISOString() : null,
    license: row.license,
  }
}

function toDetail(row: DetailRow): ToolVersionDetail {
  return {
    ...toSummary(row),
    config: decodeToolConfig(row.config, row.name),
    indexSource: row.indexSource,
    uiSource: row.uiSource,
    dataSource: row.dataSource,
    modules: decodeModules(row.modules),
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

/**
 * Whether one space may install one version — the rule the two verdicts exist
 * to express, pure so it can be read and tested in one sitting.
 *
 * A source space's own approval reaches that space and nowhere else. Anywhere
 * else, only a marketplace listing will do.
 */
export function installability(input: {
  status: ToolVersionStatus
  marketplaceStatus: MarketplaceStatus
  sourceSpaceId: string
  /** The space doing the installing. */
  spaceId: string
  /** Withdrawn after approval (lib/tools/verdicts.ts). */
  revoked?: boolean
  /** Visvine's hold over the Tool's listing, when it has one. */
  listingState?: ListingState | null
}): { ok: true } | { ok: false; error: string } {
  if (input.status !== 'approved') {
    return {
      ok: false,
      error:
        input.status === 'pending'
          ? 'This version is still waiting on an admin of the space that wrote it.'
          : `This version was ${input.status} by the space that wrote it.`,
    }
  }
  if (input.revoked) return { ok: false, error: 'This version was withdrawn by the space that made it.' }
  if (input.spaceId === input.sourceSpaceId) return { ok: true }
  if (input.listingState && input.listingState !== 'active') {
    return {
      ok: false,
      error: input.listingState === 'suspended' ? 'This tool is suspended by Visvine.' : 'This tool was removed by Visvine.',
    }
  }
  if (input.marketplaceStatus === 'approved') return { ok: true }
  return {
    ok: false,
    error: 'This tool is private to the space that wrote it — it is not listed on the marketplace.',
  }
}

/** `<spaceId>/<name>` — the marketplace identity of a Tool, across versions. */
export function toolKey(spaceId: string, name: string): string {
  return `${spaceId}/${name}`
}

/** Longest `releaseNotes` a publish stores; anything past it is clipped. */
const RELEASE_NOTES_MAX = 2048

// ── trusted publishers (pure) ────────────────────────────────────────────────

/** What `reviewedBy` reads on a version nobody looked at — a marker, not a user id. */
export const AUTO_REVIEWER = 'auto'
export const AUTO_APPROVE_NOTE = 'auto-approved: trusted publisher, unchanged manifest, clean scan'

/**
 * `TOOLS_TRUSTED_PUBLISHERS` — space ids whose re-publishes may skip the queue,
 * comma-separated. Read at call time, never at module load, so a test (or an
 * operator's restart-free change) is seen. Unset means nobody is trusted.
 */
export function trustedPublishers(raw: string | undefined = process.env.TOOLS_TRUSTED_PUBLISHERS): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  )
}

/**
 * Whether a version offered for listing may be listed without a Visvine reviewer.
 *
 * Four conditions, all required, and each one is a real half of the review:
 *   • the publishing space is TRUSTED (an operator put its id in the env) —
 *     code from a stranger is always read by a person;
 *   • an EARLIER LISTED version exists — the first version of anything is
 *     read by a person, because there is nothing to diff it against;
 *   • the MANIFEST diff against it is empty — every field that grants reach
 *     or places UI (`manifestDiff.ts#REVIEWED_FIELDS`, held complete by
 *     tests/tools-diff-coverage.test.ts): what an install can do is bounded by
 *     what it declares and the viewer's own grants, and that bound has not
 *     moved; and
 *   • the SCANS came back clean — no high or medium security finding on this
 *     version. The fast path skips a person, never the automated stages.
 */
export function shouldAutoApprove(input: {
  trustedPublishers: ReadonlySet<string>
  sourceSpaceId: string
  /** The last listed version's manifest; null for a first listing. */
  previous: ToolConfig | null
  next: ToolConfig
  /** This version's security findings as published; null when it was never scanned. */
  securityFindings: readonly CheckFinding[] | null
}): boolean {
  if (!input.trustedPublishers.has(input.sourceSpaceId)) return false
  if (!input.previous) return false
  if (!input.securityFindings || input.securityFindings.some((f) => f.severity === 'high' || f.severity === 'medium')) {
    return false
  }
  return diffManifest(input.previous, input.next).length === 0
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
 * Publish the space's working copy of one Tool as the next version — INTO ITS
 * OWN SPACE, and nowhere else.
 *
 * Who may, and what it costs them:
 *   • A space ADMIN publishes and approves in the same act — they are the
 *     approver, so asking them to press a second button would be theatre.
 *   • A MEMBER who can write the Tool's note publishes it PENDING, and their
 *     space's admins get it in the bell. That is the update queue: a member
 *     edits a Tool that is already installed, publishes, and the admin decides
 *     whether the installs move (`reviewSpaceVersion`).
 *
 * Neither reaches the marketplace. Nothing here writes `marketplaceStatus`, so
 * a Tool written in a private space is published to the people who wrote it and
 * is invisible everywhere else until an admin asks Visvine to list it
 * (lib/tools/listings.ts).
 *
 * Refuses unless the working copy compiles: the registry stores bundles, and a
 * broken snapshot would be a Tool that installs and then renders an error card.
 * A previous submission of the same Tool still waiting on an admin is
 * SUPERSEDED rather than blocking this one — the newer snapshot is what the
 * author means, and an admin asked to choose between two drafts of the same
 * Tool is being asked the wrong question.
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
  opts: {
    note?: string
    releaseNotes?: string
    /** The static stages; replaced only by a verify script that needs a hostile Tool to reach the runtime. */
    checks?: (input: StaticCheckInput) => Promise<CheckReport>
  } = {},
): Promise<PublishResult> {
  if (!TOOL_NAME_RE.test(name)) return { ok: false, status: 400, error: 'Bad tool name.' }
  const isSpaceAdmin = principalIsSuperAdmin(p)
  const folder = await toolFolderIn(context.spaceId, name)
  if (!isSpaceAdmin && !principalCanWrite(p, toolIndexPath(name, folder))) {
    return {
      ok: false,
      status: 403,
      error: 'You can only publish a tool you can edit — ask for edit access, or ask an admin to publish it.',
    }
  }

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
  // admin's visibility lens is the whole space, so these are the same notes the
  // build was made from rather than a second, possibly narrower, reading.
  const indexPath = toolIndexPath(name, folder)
  const sources = await readToolSources(spaceId, name)

  // ...and they must still hash to what the build was compiled from.
  //
  // The row above carries the BUNDLES an installer will execute; the notes here
  // carry the SOURCE a reviewer reads. They are two separate reads, so without
  // this check a write landing between them publishes benign source paired with
  // a different bundle — and `app_tool_versions` is immutable, so that pairing
  // would be permanent. The whole review gate rests on "what was approved is
  // what ships", which is exactly this equality.
  if (toolSourceHash(sources) !== buildRow.sourceHash) {
    return {
      ok: false,
      status: 409,
      error: `${name} changed while it was being published — save it again, then publish.`,
    }
  }
  if (sources.index === null) return { ok: false, status: 404, error: `No tool note at ${indexPath}.` }
  if (sources.ui === null) {
    return { ok: false, status: 400, error: `${name} has no ui.tsx — a tool must have something to render.` }
  }
  const indexNote = sources.index

  const config = build.config
  // The static stages run inside the publish, for an admin exactly as for a
  // member: an admin's publish is the space's approval, never a bypass. A
  // blocking finding writes no version, and the author reads why.
  const report = await (opts.checks ?? runStaticChecks)({
    index: indexNote,
    ui: unwrapSource(sources.ui)?.code ?? sources.ui,
    data: sources.data ? (unwrapSource(sources.data)?.code ?? sources.data) : null,
    modules: unwrapModules(sources.modules),
    config,
    build: { ok: build.ok, errors: build.errors, warnings: build.warnings, configError: build.configError },
  })
  if (reportStatus(report) === 'blocked') {
    await recordReport({ spaceId, name, versionId: null, sourceHash: buildRow.sourceHash, trigger: 'publish', report })
    const blocking = blockingFindings(report)
    return {
      ok: false,
      status: 422,
      error: `Checks blocked this publish: ${findingLine(blocking[0])}${blocking.length > 1 ? ` (and ${blocking.length - 1} more)` : ''}`,
      report,
    }
  }
  const key = toolKey(spaceId, name)
  const created = await prisma.$transaction(async (tx) => {
    // Serialize publishes of one key: superseding, the number it picks and the
    // row it writes are one decision, and two concurrent publishes would
    // otherwise both take the same number. Same advisory-lock pattern as
    // lib/spaces/spaceConfig.ts#updateSpaceConfig.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`app_tool:${key}`})::bigint)::text`
    const existing = await tx.appToolVersion.findMany({
      where: { key },
      select: { version: true, status: true },
    })
    const nextVersion = nextVersionNumber(existing.map((row) => row.version))
    // Supersede whatever the author left in their admins' queue. Only rows
    // nobody outside the space is looking at: a version already submitted to
    // the marketplace is a separate conversation with a separate reviewer, and
    // a newer draft here does not end it.
    await tx.appToolVersion.updateMany({
      where: { key, status: 'pending', marketplaceStatus: null },
      data: {
        status: 'withdrawn',
        reviewedAt: new Date(),
        reviewNote: `Superseded by v${nextVersion}.`,
      },
    })
    const row = await tx.appToolVersion.create({
      data: {
        key,
        name,
        version: nextVersion,
        title: config.title,
        description: config.description || null,
        authorUserId: p.userId,
        sourceSpaceId: spaceId,
        config: config as unknown as object,
        perimeter: config.perimeter as unknown as object,
        indexSource: splitFrontmatter(indexNote).body,
        uiSource: unwrapSource(sources.ui ?? '')?.code ?? '',
        dataSource: sources.data ? (unwrapSource(sources.data)?.code ?? '') : '',
        modules: unwrapModules(sources.modules),
        // Snapshotted from the BUILD, not re-read from icon.md: the build is
        // where sanitization happened, so this is the reviewed, trusted markup.
        iconSvg: buildRow.iconSvg,
        uiBundle: buildRow.uiBundle ?? '',
        dataBundle: buildRow.dataBundle ?? '',
        sizeBytes: build.sizeBytes,
        // An admin publishing IS the space's approval; a member's publish waits
        // for one. Nothing marketplace-facing is set either way.
        status: isSpaceAdmin ? 'approved' : 'pending',
        reviewedBy: isSpaceAdmin ? p.userId : null,
        reviewedAt: isSpaceAdmin ? new Date() : null,
        reviewNote: opts.note?.trim() ? opts.note.trim() : null,
        // Marketplace metadata: the author's release notes (clipped, never
        // refused — a long changelog is not a reason to fail a publish) and
        // the tags/preview the config declared, frozen with the snapshot.
        releaseNotes: opts.releaseNotes?.trim() ? opts.releaseNotes.trim().slice(0, RELEASE_NOTES_MAX) : null,
        tags: config.tags,
        previewUrl: config.previewUrl,
      },
      select: SUMMARY_SELECT,
    })
    return row
  })
  await recordReport({ spaceId, name, versionId: created.id, sourceHash: buildRow.sourceHash, trigger: 'publish', report })
  // Each file's digest and the package's (lib/tools/package), taken once, now.
  // A failure costs only the stored digests, which an export takes itself.
  await import('./package')
    .then((pkg) => pkg.storeVersionDigests(created.id))
    .catch((err) => logger.warn('tools.publish.digests_failed', { err, versionId: created.id }))
  void logAudit(spaceId, {
    userId: p.userId,
    name: p.name,
    action: 'tool',
    path: indexPath,
    detail: isSpaceAdmin
      ? `published and approved v${created.version} in this space`
      : `published v${created.version} — awaiting a space admin`,
  })

  if (isSpaceAdmin) {
    // Installs of this Tool pinned to an older version are offered this one.
    // Only in the space that wrote it, because that is the whole reach of a
    // space verdict — anywhere else is waiting on the marketplace.
    await flagStaleInstalls(created.key, created.id, created.version, { withinSpace: spaceId })
  }
  // A member cannot approve their own work, so their publish lands pending and
  // waits on /admin?section=approvals — that page IS the update queue.

  // Human origin on purpose: a person pressed Publish. 'agent'/'maintenance'
  // would hit the tools/ AI freeze in contextService.lockedDenial.
  // The NOTE, not the composed index: the manifest's facts live in the row,
  // and writing them back into the note is what the gate refuses.
  const note = (await readVisible(p, context, indexPath)) ?? indexNote
  const bumped = bumpIndexVersion(note, created.version)
  let warning: string | null = null
  if (bumped === null) {
    warning = `Published as version ${created.version}, but ${indexPath} has no frontmatter to record it in.`
  } else {
    const written = await writeGated(p, context, indexPath, bumped, 'edit')
    if (written.status === 'denied') {
      warning = `Published as version ${created.version}, but ${indexPath} could not be updated: ${written.reason}`
    }
  }
  return { ok: true, version: toSummary(created), warning, report }
}

/**
 * A space admin's verdict on a version one of their members published — the
 * update queue's decision.
 *
 * Approving is what puts the code within reach: only then can it be installed,
 * and only then are the space's existing installs of the same Tool offered it
 * as an upgrade. Applying that upgrade is still a separate act
 * (lib/tools/installs.ts#applyUpgrade), so approving never changes what is
 * running under anyone by itself.
 *
 * Scoped to the SOURCE space on purpose: an admin of some other space has no
 * standing over code they did not host, whatever their own rail says.
 */
export async function reviewSpaceVersion(
  versionId: string,
  decision: 'approved' | 'rejected',
  actor: { userId: string; email: string; spaceId: string; isAdmin: boolean },
  note?: string,
): Promise<ReviewResult> {
  if (decision !== 'approved' && decision !== 'rejected') {
    return { ok: false, status: 400, error: 'A review is either approved or rejected.' }
  }
  const row = await prisma.appToolVersion.findUnique({
    where: { id: versionId },
    select: { id: true, key: true, name: true, title: true, version: true, status: true, sourceSpaceId: true, authorUserId: true },
  })
  if (!row) return { ok: false, status: 404, error: 'No such tool version.' }
  if (row.sourceSpaceId !== actor.spaceId) {
    return { ok: false, status: 403, error: 'This tool was published in another space — its admins decide.' }
  }
  if (!actor.isAdmin) {
    return { ok: false, status: 403, error: 'Only space admins can approve a tool.' }
  }
  if (row.status !== 'pending') {
    return { ok: false, status: 409, error: `This version is already ${row.status}.` }
  }

  const updated = await prisma.appToolVersion.update({
    where: { id: versionId },
    data: {
      status: decision,
      reviewedBy: actor.userId,
      reviewedAt: new Date(),
      reviewNote: note?.trim() ? note.trim() : null,
    },
    select: SUMMARY_SELECT,
  })
  void logAudit(row.sourceSpaceId, {
    userId: actor.userId,
    name: actor.email,
    action: 'tool',
    path: toolIndexPath(row.name),
    detail: `${decision} v${row.version} for this space by ${actor.email}${note?.trim() ? ` — ${note.trim()}` : ''}`,
  })
  const upgraded =
    decision === 'approved'
      ? await flagStaleInstalls(row.key, versionId, row.version, { withinSpace: row.sourceSpaceId })
      : 0
  return { ok: true, version: toSummary(updated), upgraded }
}

/** An author taking back a version nobody has reviewed yet. */
export async function withdrawVersion(versionId: string, callerId: string): Promise<VersionResult> {
  const row = await prisma.appToolVersion.findUnique({
    where: { id: versionId },
    select: {
      id: true,
      status: true,
      authorUserId: true,
      name: true,
      version: true,
      sourceSpaceId: true,
      author: { select: { name: true } },
    },
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
  void logAudit(row.sourceSpaceId, {
    userId: callerId,
    name: row.author?.name ?? callerId,
    action: 'tool',
    path: toolIndexPath(row.name),
    detail: `withdrew v${row.version}`,
  })
  return { ok: true, version: toSummary(updated) }
}

/**
 * Remove a version row from the registry outright — the reviewer's bin, not
 * the author's withdraw. Any status can go; what protects a version is not its
 * verdict but its INSTALLS: while any space runs it the delete is refused (the
 * `Restrict` FK on app_tool_installs enforces the same), because uninstalling
 * is each of those spaces' own decision. An install merely OFFERED this
 * version as an upgrade just loses the offer.
 */
export async function deleteVersion(
  versionId: string,
  caller: { userId: string; email: string },
): Promise<VersionResult> {
  const row = await prisma.appToolVersion.findUnique({
    where: { id: versionId },
    select: SUMMARY_SELECT,
  })
  if (!row) return { ok: false, status: 404, error: 'No such tool version.' }

  const running = await prisma.appToolInstall.count({ where: { versionId } })
  if (running > 0) {
    return {
      ok: false,
      status: 409,
      error: `${running} ${running === 1 ? 'space runs' : 'spaces run'} this version — it can't be deleted while installed.`,
    }
  }

  await prisma.$transaction([
    prisma.appToolInstall.updateMany({
      where: { pendingVersionId: versionId },
      data: { pendingVersionId: null },
    }),
    prisma.appToolVersion.delete({ where: { id: versionId } }),
  ])
  void logAudit(row.sourceSpaceId, {
    userId: caller.userId,
    name: caller.email,
    action: 'tool',
    path: toolIndexPath(row.name),
    detail: `deleted v${row.version} from the registry`,
  })
  return { ok: true, version: toSummary(row) }
}

// ── review (super-admin) ─────────────────────────────────────────────────────

/**
 * One space's own approval queue: versions its members published that nobody
 * with the authority to say yes has looked at yet, oldest first.
 *
 * Keyed on `sourceSpaceId` rather than on the key prefix, because that column
 * is what the row was stamped with and a key is a string an admin could not
 * change anyway.
 */
export async function listSpaceApprovalQueue(spaceId: string): Promise<ToolVersionSummary[]> {
  const rows = await prisma.appToolVersion.findMany({
    where: { sourceSpaceId: spaceId, status: 'pending' },
    orderBy: { submittedAt: 'asc' },
    select: SUMMARY_SELECT,
  })
  return rows.map(toSummary)
}

/** Every LISTING awaiting Visvine, oldest submission first — a queue, not a feed. */
export async function listReviewQueue(): Promise<ToolVersionSummary[]> {
  const rows = await prisma.appToolVersion.findMany({
    where: { marketplaceStatus: 'pending' },
    orderBy: { marketplaceSubmittedAt: 'asc' },
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
    select: { id: true, key: true, name: true, title: true, version: true, marketplaceStatus: true, sourceSpaceId: true, authorUserId: true, listingId: true },
  })
  if (!row) return { ok: false, status: 404, error: 'No such tool version.' }
  if (row.marketplaceStatus !== 'pending') {
    return {
      ok: false,
      status: 409,
      error: row.marketplaceStatus
        ? `This version's listing is already ${row.marketplaceStatus}.`
        : 'This version was never submitted to the marketplace.',
    }
  }
  if (decision === 'approved') {
    const held = await globalStagesHold(versionId)
    if (held) return { ok: false, status: 409, error: held }
  }
  return decideListing(versionId, row, decision, reviewer.userId, reviewer.email, note)
}

/**
 * Why a version may not be listed yet: its global stages (the AI review and
 * the dynamic run, lib/tools/review) have not finished, or one blocked it.
 */
async function globalStagesHold(versionId: string): Promise<string | null> {
  const run = await prisma.appToolReviewRun.findFirst({
    where: { versionId },
    orderBy: { createdAt: 'desc' },
    select: { status: true },
  })
  if (!run) return 'Its review has not run — run it first.'
  if (run.status === 'queued' || run.status === 'running') return 'Its dynamic run has not finished.'
  const reports = await versionReports([versionId])
  const report = reports.get(versionId)?.report
  const blocking = report
    ? [report.ai, report.dynamic].flatMap((stage) => stage?.findings ?? []).filter((f) => f.severity === 'high')
    : []
  return blocking.length ? `Its dynamic run blocked it: ${findingLine(blocking[0])}` : null
}

/**
 * The verdict, written. Shared by a reviewer's decision and the trusted
 * publisher's fast path, which lists without a person once the automated
 * stages have passed (lib/tools/review/run.ts).
 */
export async function decideListing(
  versionId: string,
  row: { key: string; name: string; version: number; sourceSpaceId: string; listingId: string | null },
  decision: 'approved' | 'rejected',
  reviewerId: string,
  reviewerName: string,
  note?: string,
): Promise<ReviewResult> {
  const updated = await prisma.appToolVersion.update({
    where: { id: versionId },
    data: {
      marketplaceStatus: decision,
      marketplaceReviewedBy: reviewerId,
      marketplaceReviewedAt: new Date(),
      marketplaceReviewNote: note?.trim() ? note.trim() : null,
    },
    select: SUMMARY_SELECT,
  })
  void logAudit(row.sourceSpaceId, {
    userId: reviewerId,
    name: reviewerName,
    action: 'tool',
    path: toolIndexPath(row.name),
    detail: `${decision} the marketplace listing of v${row.version} by ${reviewerName}${note?.trim() ? ` — ${note.trim()}` : ''}`,
  })
  let upgraded = 0
  if (decision === 'approved') {
    const { markListed } = await import('./listings')
    await markListed(versionId)
    upgraded = await flagStaleInstalls(row.key, versionId, row.version, { listingId: row.listingId })
  }
  return { ok: true, version: toSummary(updated), upgraded }
}

/**
 * Offer an approved version to every install of the same Tool pinned to an
 * OLDER one, by setting `pendingVersionId`. AppToolInstall pins a version by
 * id, not by number, so "older than this" is a question about the joined row.
 * Returns how many installs were flagged.
 *
 * `withinSpace` is what keeps a space verdict inside that space: a space
 * approving its own code may offer that upgrade to itself, and an install
 * anywhere else is waiting on Visvine instead. Omit it — a marketplace
 * approval — and every install is offered the version, which is what a global
 * listing means.
 */
async function flagStaleInstalls(
  key: string,
  versionId: string,
  version: number,
  opts: { withinSpace?: string; listingId?: string | null } = {},
): Promise<number> {
  // A listing's upgrades follow the LISTING, across a transfer — so an
  // install of the first publisher's version is offered the second's. Newer
  // is by when it was published, since two keys number their versions apart.
  if (!opts.withinSpace && opts.listingId) {
    const next = await prisma.appToolVersion.findUnique({ where: { id: versionId }, select: { createdAt: true } })
    if (!next) return 0
    const installs = await prisma.appToolInstall.findMany({
      where: { OR: [{ listingId: opts.listingId }, { key }] },
      select: { id: true, versionId: true, version: { select: { createdAt: true } } },
    })
    const stale = installs.filter((install) => install.versionId !== versionId && install.version.createdAt < next.createdAt).map((i) => i.id)
    if (stale.length === 0) return 0
    const result = await prisma.appToolInstall.updateMany({
      where: { id: { in: stale } },
      data: { pendingVersionId: versionId, listingId: opts.listingId },
    })
    return result.count
  }
  const installs = await prisma.appToolInstall.findMany({
    where: { key, ...(opts.withinSpace ? { spaceId: opts.withinSpace } : {}) },
    select: { id: true, version: { select: { version: true } } },
  })
  const stale = installs.filter((install) => install.version.version < version).map((i) => i.id)
  if (stale.length === 0) return 0
  const result = await prisma.appToolInstall.updateMany({
    where: { id: { in: stale } },
    data: { pendingVersionId: versionId },
  })
  return result.count
}

// ── browse and history ───────────────────────────────────────────────────────

/**
 * Take one page out of the folded listing, keyed by the last key of the previous
 * page.
 *
 * The case worth naming: a cursor key can leave the fold between pages — the
 * version is withdrawn, rejected, or the Tool is renamed. Indexing by key then
 * finds nothing, and treating "not found" as "start of list" would serve page one
 * again with a non-null cursor, so a client paging the marketplace never
 * terminates. An unfindable cursor ends the listing instead: better to stop one
 * page early than to loop.
 *
 * Pure, so the rule is tested without a database (tests/tools-registry.test.ts).
 */
export function pageByCursor<T extends { key: string }>(
  rows: T[],
  cursor: string | null,
  limit?: number,
): { page: T[]; nextCursor: string | null } {
  const size = Math.max(1, Math.min(limit ?? BROWSE_PAGE, 100))
  const found = cursor ? rows.findIndex((row) => row.key === cursor) : -1
  if (cursor && found === -1) return { page: [], nextCursor: null }
  const start = found + 1
  const page = rows.slice(start, start + size)
  return {
    page,
    nextCursor: start + size < rows.length ? (page[page.length - 1]?.key ?? null) : null,
  }
}


/**
 * The marketplace listing: the newest LISTED version of each Tool, newest
 * publication first, with the author's name and how many spaces run it.
 *
 * Listed means both verdicts said yes — its own space approved the code and
 * Visvine approved the listing. A version its space merely published is not
 * here, which is the whole reason a Tool written in a private space is invisible
 * to everyone outside it.
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
  const held = await prisma.appToolListing.findMany({
    where: { state: { not: 'active' } },
    select: { key: true },
  })
  const rows = await prisma.appToolVersion.findMany({
    where: {
      status: 'approved',
      marketplaceStatus: 'approved',
      revokedAt: null,
      ...(held.length ? { key: { notIn: held.map((h) => h.key) } } : {}),
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
  latest.sort(
    (a, b) =>
      (b.marketplaceSubmittedAt ?? b.submittedAt).getTime() -
        (a.marketplaceSubmittedAt ?? a.submittedAt).getTime() || a.key.localeCompare(b.key),
  )

  const { page, nextCursor } = pageByCursor(latest, opts.cursor ?? null, opts.limit)

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
    nextCursor,
  }
}

/** One version's summary — no sources, no bundles. */
export async function getVersionSummary(id: string): Promise<ToolVersionSummary | null> {
  const row = await prisma.appToolVersion.findUnique({ where: { id }, select: SUMMARY_SELECT })
  return row ? toSummary(row) : null
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

/** What `AuthoredToolSummary.publication` carries — enough for the roster to
 *  show a status chip and a reviewer's note without a second request. */
export interface ToolPublicationSummary {
  versionId: string
  version: number
  status: ToolVersionStatus
  reviewNote: string | null
  submittedAt: string
  reviewedAt: string | null
  /** Null until someone asked Visvine to list it — the usual case. */
  marketplaceStatus: MarketplaceStatus
  marketplaceReviewNote: string | null
}

const PUBLICATION_SELECT = {
  id: true,
  key: true,
  version: true,
  status: true,
  reviewNote: true,
  submittedAt: true,
  reviewedAt: true,
  marketplaceStatus: true,
  marketplaceReviewNote: true,
} as const

/**
 * The newest version of each of these keys, whatever its status — pending,
 * rejected and withdrawn included, since a rejection note is the whole point.
 * One query for a whole roster, folded in memory like `browseVersions`: rows
 * come back ordered newest-version-first, so the first one seen per key wins.
 */
export async function latestPublications(
  keys: readonly string[],
): Promise<Map<string, ToolPublicationSummary>> {
  const uniqueKeys = [...new Set(keys)]
  if (uniqueKeys.length === 0) return new Map()
  const rows = await prisma.appToolVersion.findMany({
    where: { key: { in: uniqueKeys } },
    orderBy: { version: 'desc' },
    select: PUBLICATION_SELECT,
  })
  const out = new Map<string, ToolPublicationSummary>()
  for (const row of rows) {
    if (out.has(row.key)) continue
    out.set(row.key, {
      versionId: row.id,
      version: row.version,
      status: decodeStatus(row.status),
      reviewNote: row.reviewNote,
      submittedAt: row.submittedAt.toISOString(),
      reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
      marketplaceStatus: row.marketplaceStatus ? decodeStatus(row.marketplaceStatus) : null,
      marketplaceReviewNote: row.marketplaceReviewNote,
    })
  }
  return out
}

/**
 * The version a reviewer should diff against: the highest one BELOW this number
 * that their own verdict has already passed. Null for a first submission, and
 * null when every earlier version was refused — a reviewer comparing against
 * something nobody shipped would be reading a diff of two unshipped things.
 *
 * `scope` picks whose yes counts. A space admin diffs against the last version
 * THEIR space approved; Visvine diffs against the last one it LISTED, which is
 * the only version other spaces could be running.
 */
export async function previousApprovedVersion(
  key: string,
  before: number,
  scope: 'space' | 'marketplace' = 'space',
): Promise<ToolVersionDetail | null> {
  const row = await prisma.appToolVersion.findFirst({
    where: {
      key,
      version: { lt: before },
      ...(scope === 'marketplace' ? { marketplaceStatus: 'approved' } : { status: 'approved' }),
    },
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
export async function perimeterDiffForVersion(
  versionId: string,
  scope: 'space' | 'marketplace' = 'marketplace',
): Promise<{
  previous: { id: string; version: number; surfaces: ToolConfig['surfaces'] } | null
  diff: PerimeterDiff
} | null> {
  const row = await prisma.appToolVersion.findUnique({
    where: { id: versionId },
    select: { key: true, version: true, perimeter: true },
  })
  if (!row) return null
  const previous = await previousApprovedVersion(row.key, row.version, scope)
  return {
    previous: previous ? { id: previous.id, version: previous.version, surfaces: previous.config.surfaces } : null,
    diff: diffPerimeter(previous?.perimeter ?? EMPTY_PERIMETER, decodeToolPerimeter(row.perimeter)),
  }
}
