/**
 * The wire shapes of the Tools REST routes — what `app/api/tools/*` and
 * `app/api/spaces/[spaceId]/tools/*` answer with, in one place.
 *
 * The routes annotate their bodies with these, and the client code (the
 * marketplace, the review panel, the author page) types its fetches with the
 * same names, so a change to an envelope is a type error on both sides rather
 * than a runtime surprise in one. Types only, and no React — this is `lib/`.
 *
 * The library types are RE-EXPORTED here rather than restated: an install
 * summary on the wire IS lib/tools/installs.ts#InstallSummary, and a second
 * declaration of it would be a copy to keep in step.
 */
import type { BuildSummary } from './builds'
import type { ToolConfig } from './config'
import type { InstallSummary, TypeClaimConflict } from './installs'
import type { PerimeterDiff } from './perimeter'
import type { ToolRequirements } from './requirements'
import type { BrowseEntry, ToolVersionStatus, ToolVersionSummary } from './registry'
import type { AuthoredToolDetail, AuthoredToolSummary } from './service'
import type { CheckReport } from './checks/findings'
import type { StoredReport } from './checks/runs'
import type { ListingAbout, ListingCard } from './directory'

export type { InstallSummary } from './installs'
export type { ToolVersionSummary } from './registry'
export type { AuthoredToolDetail, AuthoredToolSummary } from './service'

// ── browse ───────────────────────────────────────────────────────────────────

/**
 * One marketplace card: the latest approved version of a Tool, its install
 * count, and — only when the request named a space — whether that space already
 * runs it. Absent rather than `false` when no space was named, so the UI can
 * tell "not installed" from "didn't ask".
 */
export interface BrowseItem extends BrowseEntry {
  installedInSpace?: boolean
}

export interface BrowseResponse {
  versions: BrowseItem[]
  /** Pass back as `?cursor=` for the next page; null when this was the last. */
  nextCursor: string | null
}

// ── one version ──────────────────────────────────────────────────────────────

/** A line of the Tool's publication trail, newest first. */
export interface VersionHistoryEntry {
  version: number
  status: ToolVersionStatus
  reviewedAt: string | null
  /** The author's release notes for that version, or null. */
  releaseNotes: string | null
}

/**
 * A version opened: everything the marketplace detail drawer and the author's
 * page draw, plus the reviewer's question — what this version's declared reach
 * changed against the last approved one.
 *
 * The two code sources are present only for a Visvine super-admin or the
 * version's own author. An approved Tool's reach is public because installing
 * it is a decision anyone may need to make; its source is not.
 */
export interface VersionDetail extends ToolVersionSummary {
  config: ToolConfig
  /** The index note's BODY at publish time — the Tool's docs, no frontmatter. */
  indexSource: string
  perimeterDiff: PerimeterDiff
  previousVersion: { id: string; version: number } | null
  history: VersionHistoryEntry[]
  uiSource?: string
  dataSource?: string
  /** The checks it was published with; null for a version published before there were any. */
  checks: CheckReport | null
}

export interface VersionResponse {
  version: VersionDetail
}

// ── approvals (space admin) ──────────────────────────────────────────────────

/**
 * A row of a space's OWN queue: a version one of its members published, and
 * what it reaches that the last version this space approved didn't.
 *
 * The same shape as a marketplace queue row, and deliberately so — the two
 * reviews ask the same question of different people about different things
 * (this one about code, that one about a listing), so one screen renders both.
 */
export interface ApprovalQueueItem extends ToolVersionSummary {
  perimeterDiff: PerimeterDiff
  previousVersion: { id: string; version: number } | null
  /** The checks it was published with; null for a version published before there were any. */
  checks: CheckReport | null
}

export interface ApprovalQueueResponse {
  queue: ApprovalQueueItem[]
}

export interface ApprovalDecisionResponse {
  version: ToolVersionSummary
  /** Installs in this space's subtree now offered this version as an upgrade. */
  upgraded: number
}

/** What a marketplace submit or withdraw answers with: the version, re-read. */
export interface ListingResponse {
  version: ToolVersionSummary
}

// ── review (super-admin) ─────────────────────────────────────────────────────

/** Visvine's review of a version offered for listing: the AI read and the dynamic run (lib/tools/review). */
interface ReviewRunSummary {
  status: string
  runner: string | null
  startedAt: string | null
  finishedAt: string | null
  error: string | null
}

/** A queue row: the submission, and what it wants that the last one didn't. */
export interface ReviewQueueItem extends ToolVersionSummary {
  perimeterDiff: PerimeterDiff
  previousVersion: { id: string; version: number } | null
  /** The checks it was published with — and Visvine's two, once they ran. */
  checks: CheckReport | null
  review: ReviewRunSummary | null
  /** The listing it goes out under: who co-signed, and whether its publisher is verified. */
  listing: { id: string; verified: boolean; cosignedBy: string | null } | null
}

export interface ReviewQueueResponse {
  queue: ReviewQueueItem[]
}

/** The "before" side of the code diff: the last approved version's sources. */
export interface VersionSources {
  id: string
  version: number
  indexSource: string
  uiSource: string
  dataSource: string
}

export interface ReviewDetailResponse {
  version: VersionDetail
  /** Null for a first submission — the diff is then against nothing. */
  previous: VersionSources | null
  /** Visvine's review of it, when one ran or waits. */
  review: ReviewRunSummary | null
  /** The listing it goes out under, and who co-signed it. */
  listing: { id: string; verified: boolean; cosigner: string | null } | null
}

export interface ReviewDecisionResponse {
  version: ToolVersionSummary
  /** Installs of older versions now offered this one as an upgrade. */
  upgraded: number
}

// ── installs (space-scoped) ──────────────────────────────────────────────────

export interface InstallsResponse {
  installs: InstallSummary[]
  /** Whether the caller may install, upgrade, enable or uninstall here. */
  isAdmin: boolean
}

export interface InstallCreatedResponse {
  install: InstallSummary
  /** `page` claims not granted because another install owns that type. */
  conflicts: TypeClaimConflict[]
  /** `page` claims that became tabs: built-in pages stay built in. */
  downgraded: string[]
}

export interface InstallUpdatedResponse {
  install: InstallSummary
  /** Every install, re-checked — set only by `{ recheck: true }`. */
  installs?: InstallSummary[]
}

// ── authoring (working copies) ───────────────────────────────────────────────

export interface AuthoredToolsResponse {
  tools: AuthoredToolSummary[]
}

/**
 * What a scaffold answers with: the new working copy, where to look at it, and
 * the Visvine Tools MCP server address the success screen hands to a coding agent
 * (the same value Settings → MCP shows — `mcpResourceUrl('tools')`).
 */
export interface CreateToolResponse {
  tool: { name: string; path: string; nodeId: string; title: string }
  build: BuildSummary
  previewUrl: string
  creatorMcpUrl: string
}

/**
 * What `GET …/tools/authoring/<name>` answers with: the working copy, what this
 * space fails to satisfy of its declared reach, and its publication trail.
 */
export interface AuthoredToolView {
  tool: AuthoredToolDetail
  /**
   * Null when the config doesn't parse — nothing was declared, which is not the
   * same as nothing missing.
   */
  requirements: ToolRequirements | null
  /** Every version published from this working copy, newest first. */
  versions: ToolVersionSummary[]
  /** Whether the viewer may edit the working copy — and so publish it. */
  canEdit: boolean
  /** The install of this Tool in this space, when it runs here. */
  installId: string | null
  /** The last check report on the working copy; `stale` once the sources moved on. */
  checks: (StoredReport & { stale: boolean }) | null
  /** The checks each published version carries, by version id. */
  versionChecks: Record<string, CheckReport>
}

export interface PublishResponse {
  version: ToolVersionSummary
  /** Set when the registry row landed but the note's `version:` bump didn't. */
  warning: string | null
}


/**
 * The 409 a publish gets when the working copy does not compile. The build
 * rides along so the author reads the diagnostics without a second request.
 */
export interface PublishBlockedResponse {
  error: string
  build: BuildSummary | null
  /** Set when the checks, not the compiler, stopped it. */
  report?: CheckReport
}

/** What running the checks on a working copy answers with. */
export interface CheckResponse {
  checks: StoredReport & { stale: boolean }
}

// ── the directory (Discover → Tools) ─────────────────────────────────────────

export interface DirectoryResponse {
  items: ListingCard[]
  nextCursor: string | null
}

/** A space the viewer could install a listing into, and why not when they cannot. */
export interface InstallTargetSpace {
  id: string
  name: string
  installed: boolean
  refusal: string | null
}

export interface ListingAboutResponse {
  about: ListingAbout
  spaces: InstallTargetSpace[]
}

export interface ListingSourceResponse {
  versionId: string
  files: Record<string, string>
}

/** A listing this space publishes, or one offered to it. */
export interface SpaceListing {
  listingId: string
  key: string
  title: string
  verified: boolean
  installs: number
  /** Offered to another space and waiting on it. */
  transferTo: { id: string; name: string | null } | null
}

export interface SpaceListingsResponse {
  listings: SpaceListing[]
  /** Listings another space offered to this one. */
  offers: Array<{ listingId: string; key: string; title: string; from: { id: string; name: string | null } }>
}

export interface ImportResponse {
  name: string
  renamedFrom: string | null
  provenance: { publisher: string; release: string | null; version: number | null } | null
  unverifiedSignature: boolean
  ignored: string[]
  buildOk: boolean
  problems: string[]
}
