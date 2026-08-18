/**
 * The wire shapes of the Tools REST routes — what `app/api/tools/*` and
 * `app/api/communities/[spaceId]/tools/*` answer with, in one place.
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
}

export interface VersionResponse {
  version: VersionDetail
}

// ── review (super-admin) ─────────────────────────────────────────────────────

/** A queue row: the submission, and what it wants that the last one didn't. */
export interface ReviewQueueItem extends ToolVersionSummary {
  perimeterDiff: PerimeterDiff
  previousVersion: { id: string; version: number } | null
}

export interface ReviewQueueResponse {
  queue: ReviewQueueItem[]
}

/**
 * `?status=reviewed` on the same route: the decisions already made, newest
 * first. No perimeter diff — a reviewer reading their own trail is asking what
 * they decided, not what the submission was asking for; opening a row still
 * answers that.
 */
export interface ReviewHistoryResponse {
  reviewed: ToolVersionSummary[]
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
}
