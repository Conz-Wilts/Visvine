/**
 * A space's installed Tools — install, upgrade, enable, claim, uninstall.
 *
 * An install (`AppToolInstall`) is a space pinning one approved
 * `AppToolVersion`: `versionId` is the code that runs, `slug` is the URL segment
 * and rail key it runs under, `requirements` is what the Tool asked for that
 * this space hasn't got, and `typeClaims` is which context types it owns a page
 * or a tab for. Nothing here ever reads the authoring space's working copy — an
 * install is a snapshot relationship, so an author editing their Tool cannot
 * change what another space is running.
 *
 * Three decisions live here as pure functions, because they are the ones with
 * rules rather than rows: `uniqueSlug` (two Tools called "board" in one space),
 * `resolveTypeClaims` (who owns a type's page) and the requirements check next
 * door in ./requirements.ts.
 *
 * Everything that writes takes `actor: { userId, email }` and gates on `isAdmin`:
 * members author Tools, admins install them. Reads are not gated here — an
 * install's title and rail row are space furniture every member sees, and the
 * Tool's own data reach is enforced per call by the bridge under the viewer's
 * own grants.
 *
 * Writes that touch BOTH the install row and the space's `featureConfig` run
 * inside `updateSpaceConfig`, using its transaction: the rail key and the row it
 * points at must land together, and its per-space advisory lock is also what
 * makes slug de-duplication and the one-page-per-type rule safe against two
 * admins pressing Install at once.
 */
import prisma from '@/lib/prisma'
import { adoptRows, detachRows, dropPreviewRows } from './collections'
import { isAdmin } from '@/lib/auth'
import { principalForUser } from '@/lib/agents/principal'
import { listAgents } from '@/lib/agents/service'
import { listConnectors } from '@/lib/connectors/service'
import { logAudit } from '@/lib/notes/audit'
import { SHARED_OWNER_KEY, type Context } from '@/lib/notes/store'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import { readSpaceConfig, updateSpaceConfig, UnknownSpaceError } from '@/lib/spaces/spaceConfig'
import {
  ALL_FEATURE_KEYS,
  mergeFeatureConfig,
  NAV_HIDDEN_FEATURE_KEYS,
  toolRailKey,
} from '@/lib/featureAccess'
import { DEFAULT_NODE_TYPES, type NodeTypeConfig } from '@/lib/types/context'
import type { SpaceFeatureConfig } from '@/lib/types/space'
import { manifestOf, TOOL_NAME_RE, type ToolBandAction, type ToolNav, type ToolTypeSurface } from './config'
import { diffPerimeter, type PerimeterDiff } from './perimeter'
import {
  boundTypeClaims,
  defaultBindings,
  planBindings,
  planSettings,
  type BindingValues,
} from '@visvine/tool-protocol/bindings'
import type { BindingSlot, SettingSpec } from '@visvine/tool-protocol/manifest'
import { bindableSpace } from './bindable'
import {
  decodeToolConfig,
  decodeToolPerimeter,
  decodeVersionStatus,
  installability,
  toolKey,
  type RegistryError,
} from './registry'
import { decodeListingState, listingHoldFor, runDenial, type ListingHold } from './verdicts'
import { stagedInstallRefusal } from './listings'
import { verifiedPublishers } from './publishers'
import {
  boundRequirements,
  isDegraded,
  parseRequirements,
  requirementsEqual,
  type SpaceAvailability,
  type ToolRequirements,
} from './requirements'

/** Which surface an install owns for a context type. */
export type TypeClaimMode = 'page' | 'tab'

/** The admin-confirmed claims of one install, keyed by lower-case type name. */
export type TypeClaims = Record<string, TypeClaimMode>

/** An admin's answer to one declared type surface: take it as a page or tab, or leave it. */
export type TypeClaimChoice = TypeClaimMode | 'none'

/** One install, as the marketplace's Installed tab and the admin console read it. */
export interface InstallSummary {
  id: string
  key: string
  slug: string
  title: string
  description: string | null
  version: number
  enabled: boolean
  requirements: ToolRequirements
  degraded: boolean
  typeClaims: TypeClaims
  /** The rail row the Tool asks for, or null when it has no page of its own. */
  rail: { label: string; icon: string } | null
  /** The type surfaces the Tool DECLARED — what it wanted, before resolution. */
  types: ToolTypeSurface[]
  /** An approved newer version waiting for an admin, and what it changes. */
  pendingVersion: { id: string; version: number; perimeterDiff: PerimeterDiff } | null
  /** The house this install came down from, when it is a shared Tool (lib/tools/share.ts). */
  sharedFrom?: { id: string; name: string } | null
  /** Why it no longer runs — withdrawn, or its listing held (lib/tools/verdicts.ts). */
  stopped?: string | null
  /** The slots the version declares, and what each is bound to here. */
  slots: Record<string, BindingSlot>
  bindings: BindingValues
  /** The settings the version declares, and the values set here (unset = the default). */
  settingSpecs: Record<string, SettingSpec>
  settings: Record<string, unknown>
  /** For a Tool from outside the space: who published it, and whether Visvine reviewed it. */
  provenance?: { publisher: string | null; reviewed: boolean; verified: boolean } | null
  /** The collections the version keeps rows in — what an admin's export holds. */
  collections: string[]
}

/**
 * The installed-Tools slice of the space DTO — what the sidebar, the `/t/<slug>`
 * page and the type-page dispatch need on every render, and nothing more.
 * `icon`/`label` are null for a Tool with no rail row (it lives on a type page).
 * `iconSvg` carries the Tool's OWN glyph when it shipped one — already
 * sanitized at build time and snapshotted at publish (lib/tools/iconSvg.ts), so
 * the rail renders it as-is.
 */
export interface InstalledToolDto {
  /** The install row's id — what `BridgeTarget { kind: 'install' }` names, so
   *  the `/t/<slug>` page can mount a frame without a lookup of its own. Not a
   *  secret: every bridge and frame-token call re-derives the space and the
   *  viewer's standing from it server-side. */
  id: string
  key: string
  slug: string
  title: string
  icon: string | null
  iconSvg: string | null
  label: string | null
  href: string
  enabled: boolean
  degraded: boolean
  types: TypeClaims
  /** The house this install came down from, when it is a shared Tool (lib/tools/share.ts). */
  sharedFrom?: { id: string; name: string } | null
  /** Why it no longer runs, drawn on its page instead of the frame. */
  stopped?: string | null
  /** The Tool's name — its folder in the space that wrote it. */
  name: string
  /** The published version it runs. */
  version: number
  /** The Tool's own sections and band buttons, drawn by the host on its page. */
  nav: ToolNav | null
  actions: ToolBandAction[]
  /** For a Tool from outside the space: who published it, and whether Visvine reviewed it. */
  provenance?: { publisher: string | null; reviewed: boolean; verified: boolean } | null
}

export type InstallResult =
  | {
      ok: true
      install: InstallSummary
      /** `page` claims that became tabs: built-in pages stay built in. */
      downgraded: string[]
      /** `page` claims not granted because another install owns that type. */
      conflicts: TypeClaimConflict[]
    }
  | RegistryError

export type InstallUpdateResult = { ok: true; install: InstallSummary } | RegistryError

export type UninstallResult = { ok: true } | RegistryError

export type RefreshResult = { ok: true; installs: InstallSummary[] } | RegistryError

/** A `page` claim refused because somebody else already owns that type's page. */
export interface TypeClaimConflict {
  type: string
  /** Slug of the install that holds it, so the admin knows who to uninstall. */
  heldBy: string
}

export interface TypeClaimResolution {
  claims: TypeClaims
  downgraded: string[]
  conflicts: TypeClaimConflict[]
}

/** A Tool name is a slug is a rail key, so the ceiling is TOOL_NAME_RE's. */
const MAX_SLUG_LENGTH = 63

// ── slugs (pure) ─────────────────────────────────────────────────────────────

/**
 * The slug this install gets: the Tool's own name, or that name with a counter
 * when the space already runs something under it.
 *
 * Two spaces may publish a Tool called `board`; a space may install both. The
 * slug is what `/t/<slug>` and the `tool:<slug>` rail key are built from, so it
 * has to be unique per space — and it has to stay a valid tool name, hence the
 * truncation: `-2` replaces the tail rather than pushing the name past 63 chars.
 */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  // Candidates are distinct for distinct counters, so one of the first
  // `taken.size + 1` of them is free.
  for (let n = 2; n <= taken.size + 2; n++) {
    const suffix = `-${n}`
    const candidate = `${base.slice(0, MAX_SLUG_LENGTH - suffix.length)}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
  return base
}

// ── type claims (pure) ───────────────────────────────────────────────────────

/**
 * Which of the type surfaces a Tool asked for this space actually grants it.
 *
 * Two rules, both from the brief:
 *
 *   • **Built-ins win.** `mode: page` is only ever granted for a member-invented
 *     type (`NodeTypeConfig.scope: 'note'`). A page claim on person/space/event/
 *     resource — or on a type this space doesn't have at all — is DOWNGRADED to a
 *     tab rather than refused: the Tool still gets its surface, it just can't
 *     replace a member's profile or a space's home page with it.
 *   • **One page per type.** If another install already owns a type's page, this
 *     one is left out of the claims entirely and reported as a conflict, for an
 *     admin to decide. Auto-granting would silently swap out a page somebody is
 *     already using; auto-tabbing would look like it worked.
 *
 * `pageOwners` maps a type to the slug of the install holding its page, and must
 * exclude the install being resolved (an upgrade re-resolves its own claims).
 */
export function resolveTypeClaims(
  requested: readonly ToolTypeSurface[],
  space: { customTypes: readonly string[]; pageOwners: ReadonlyMap<string, string> },
): TypeClaimResolution {
  const custom = new Set(space.customTypes.map((name) => name.trim().toLowerCase()))
  const claims: TypeClaims = {}
  const downgraded: string[] = []
  const conflicts: TypeClaimConflict[] = []
  const seen = new Set<string>()

  for (const claim of requested) {
    const type = claim.type.trim().toLowerCase()
    if (!type || seen.has(type)) continue
    seen.add(type)
    if (claim.mode !== 'page') {
      claims[type] = 'tab'
      continue
    }
    if (!custom.has(type)) {
      downgraded.push(type)
      claims[type] = 'tab'
      continue
    }
    const heldBy = space.pageOwners.get(type)
    if (heldBy !== undefined) {
      conflicts.push({ type, heldBy })
      continue
    }
    claims[type] = 'page'
  }
  return { claims, downgraded, conflicts }
}

/** Decode the stored `typeClaims` JSON, dropping anything that isn't a claim. */
function parseTypeClaims(raw: unknown): TypeClaims {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: TypeClaims = {}
  for (const [type, mode] of Object.entries(raw as Record<string, unknown>)) {
    if (mode === 'page' || mode === 'tab') out[type.trim().toLowerCase()] = mode
  }
  return out
}

// ── what the space has ───────────────────────────────────────────────────────

function sharedContext(spaceId: string): Context {
  return { spaceId, ownerKey: SHARED_OWNER_KEY }
}

export interface SpaceFacts {
  available: SpaceAvailability
  /** Member-invented types (`scope: 'note'`), lower-cased — the pageable ones. */
  customTypes: string[]
}

/**
 * The three name spaces a Tool's perimeter is checked against, plus which of the
 * types a Tool may own the page for.
 *
 * The one reading of "what does this space have": installing/upgrading/
 * rechecking, check_tool (lib/mcp/appTools.ts) and the authoring checklist
 * (lib/tools/service.ts#toolRequirementsInSpace) all call this, so the three can
 * no longer drift into disagreeing checklists. Which principal to read under is
 * the CALLER's decision, not this function's — an install reads under the acting
 * admin's (admins bypass every context gate, so it's the whole space either way),
 * while an author's or a caller's own checklist reads under their own (they
 * cannot use what they cannot see).
 *
 * Node types fold the space's stored vocabulary together with the built-in
 * defaults, because `findNodeTypeConfig` resolves a built-in whether or not the
 * column lists it — a Tool declaring `person` in a space that never edited its
 * types must not read as a missing requirement.
 */
export async function spaceFacts(p: ContextPrincipal, context: Context): Promise<SpaceFacts> {
  const [connectors, agents, config] = await Promise.all([
    listConnectors(p, context),
    listAgents(p, context),
    readSpaceConfig(context.spaceId),
  ])

  const stored = (config?.nodeTypes ?? []) as NodeTypeConfig[]
  const types = new Set<string>()
  for (const type of [...stored, ...DEFAULT_NODE_TYPES]) {
    if (typeof type?.name === 'string' && type.name.trim()) types.add(type.name.trim().toLowerCase())
  }

  return {
    available: {
      connectors: connectors.map((c) => c.name),
      types: [...types],
      agents: agents.agents.map((a) => a.name),
    },
    customTypes: stored
      .filter((type) => type?.scope === 'note' && typeof type.name === 'string')
      .map((type) => type.name.trim().toLowerCase()),
  }
}

/** `spaceFacts` for an acting admin identified by user id, or null when they are
 *  not a member of the space at all — install/upgrade/recheck's own principal. */
async function spaceFactsForActor(spaceId: string, userId: string): Promise<SpaceFacts | null> {
  const principal = await principalForUser(spaceId, userId)
  if (!principal) return null
  return spaceFacts(principal, sharedContext(spaceId))
}

// ── rail placement ───────────────────────────────────────────────────────────

/**
 * `featureConfig.order` with this Tool's rail key appended.
 *
 * The subtlety: an EMPTY `order` means "the registry's own order"
 * (`sortFeatureKeys`), so writing `['tool:deals']` over it would rank the Tool
 * first — and the first visible entry is the tab members land on when they enter
 * the space. Installing a Tool must not move the front door, so an absent order
 * is materialised as the registry order first, with the Tool after it.
 */
export function orderWithRail(config: SpaceFeatureConfig, key: string): string[] {
  const current = config.order ?? []
  const base =
    current.length > 0
      ? current
      : ALL_FEATURE_KEYS.filter((feature) => !NAV_HIDDEN_FEATURE_KEYS.includes(feature))
  return base.includes(key) ? [...base] : [...base, key]
}

/**
 * The feature config with an installed Tool's rail row placed: on the rail (the
 * default) or tucked into More. Explicitly on, so a re-install never inherits
 * an old "off" from a space that had this slug before.
 */
export function featureConfigWithRail(
  config: SpaceFeatureConfig,
  key: string,
  placement: 'rail' | 'more' = 'rail',
): SpaceFeatureConfig {
  const more = config.more ?? []
  return mergeFeatureConfig(config, {
    order: orderWithRail(config, key),
    enabled: { [key]: true },
    ...(placement === 'more'
      ? { more: more.includes(key) ? more : [...more, key] }
      : more.includes(key)
        ? { more: more.filter((entry) => entry !== key) }
        : {}),
  })
}

/** The same three lists with a Tool's rail key taken out of all of them. */
export function featureConfigWithoutRail(config: SpaceFeatureConfig, key: string): SpaceFeatureConfig {
  const without = (list: string[] | undefined) =>
    list ? list.filter((entry) => entry !== key) : undefined
  return mergeFeatureConfig(config, {
    ...(config.order ? { order: without(config.order) } : {}),
    ...(config.more ? { more: without(config.more) } : {}),
    // An uninstall is not a hide: leaving the key in `adminOnly` would silently
    // restrict the Tool if the space ever installed it again.
    ...(config.adminOnly ? { adminOnly: without(config.adminOnly) } : {}),
  })
}

// ── bindings ─────────────────────────────────────────────────────────────────

/** A stored binding map, string values only. */
function bindingValuesOf(raw: unknown): BindingValues {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

/**
 * A version as an install of it runs: its config, its manifest, its binding
 * values, and its type claims BOUND to them — a `$deal` claim is a claim on
 * whichever type this install bound it to.
 */
function boundVersion(rawConfig: unknown, name: string, rawBindings: unknown) {
  const config = decodeToolConfig(rawConfig, name)
  const manifest = manifestOf(config)
  const values = bindingValuesOf(rawBindings)
  const claims = boundTypeClaims(config.surfaces.types, manifest, values).map((claim) => ({ ...claim, type: claim.type.toLowerCase() }))
  return { config, manifest, values, claims }
}

/** The stored settings that are still declared: a setting a version dropped is not carried into the next write. */
function declaredSettings(raw: unknown, manifest: ReturnType<typeof manifestOf>): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return Object.fromEntries(Object.entries(raw).filter(([key]) => key in manifest.settings))
}

/**
 * The stored claims with each `$type` claim moved to the type it is bound to
 * now — a Deal page follows the slot to Opportunity when the slot is re-bound.
 */
function followRebound(
  stored: TypeClaims,
  before: readonly ToolTypeSurface[],
  after: readonly ToolTypeSurface[],
): TypeClaims {
  const out: TypeClaims = { ...stored }
  before.forEach((claim, i) => {
    const next = after[i]
    if (!next || next.type === claim.type || !(claim.type in stored)) return
    out[next.type] = stored[claim.type]
    delete out[claim.type]
  })
  return out
}

// ── row → DTO ────────────────────────────────────────────────────────────────

const INSTALL_SELECT = {
  id: true,
  spaceId: true,
  key: true,
  slug: true,
  enabled: true,
  requirements: true,
  typeClaims: true,
  bindings: true,
  settings: true,
  pendingVersionId: true,
  sharedFromSpaceId: true,
  listingId: true,
  sharedFromSpace: { select: { id: true, name: true } },
  version: {
    select: {
      id: true,
      name: true,
      version: true,
      title: true,
      description: true,
      config: true,
      perimeter: true,
      iconSvg: true,
      sourceSpaceId: true,
      revokedAt: true,
      revokeReason: true,
      marketplaceStatus: true,
    },
  },
} as const

interface InstallRow {
  id: string
  spaceId: string
  key: string
  slug: string
  enabled: boolean
  requirements: unknown
  typeClaims: unknown
  bindings: unknown
  settings: unknown
  pendingVersionId: string | null
  sharedFromSpaceId: string | null
  listingId: string | null
  sharedFromSpace: { id: string; name: string } | null
  version: {
    id: string
    name: string
    version: number
    title: string
    description: string | null
    config: unknown
    perimeter: unknown
    iconSvg: string | null
    sourceSpaceId: string
    revokedAt: Date | null
    revokeReason: string | null
    marketplaceStatus: string | null
  }
}

/**
 * The listings a batch of installs from outside their spaces follow — by
 * listing id (which a transfer keeps), else by key — with Visvine's hold over
 * each and who publishes it now.
 */
type HoldLookup = ReadonlyMap<string, ListingHold>

function holdKey(row: Pick<InstallRow, 'listingId' | 'key'>): string {
  return row.listingId ?? row.key
}

function isForeign(row: InstallRow): boolean {
  return row.spaceId !== row.version.sourceSpaceId && !row.sharedFromSpaceId
}

async function holdsFor(rows: readonly InstallRow[]): Promise<HoldLookup> {
  const foreign = rows.filter((row) => row.spaceId !== row.version.sourceSpaceId)
  if (foreign.length === 0) return new Map()
  const ids = [...new Set(foreign.map((row) => row.listingId).filter((id): id is string => !!id))]
  const keys = [...new Set(foreign.filter((row) => !row.listingId).map((row) => row.key))]
  const listings = await prisma.appToolListing.findMany({
    where: { OR: [...(ids.length ? [{ id: { in: ids } }] : []), ...(keys.length ? [{ key: { in: keys } }] : [])] },
    select: { id: true, key: true, state: true, stateReason: true, stagedUntil: true, publisherSpaceId: true },
  })
  const publisherIds = [...new Set(listings.map((l) => l.publisherSpaceId))]
  const [spaces, verified] = await Promise.all([
    prisma.space.findMany({ where: { id: { in: publisherIds } }, select: { id: true, name: true } }),
    verifiedPublishers(publisherIds),
  ])
  const names = new Map(spaces.map((space) => [space.id, space.name]))
  const out = new Map<string, ListingHold>()
  for (const listing of listings) {
    const hold: ListingHold = {
      state: decodeListingState(listing.state),
      stateReason: listing.stateReason,
      stagedUntil: listing.stagedUntil,
      publisher: names.get(listing.publisherSpaceId) ?? null,
      verified: verified.has(listing.publisherSpaceId),
    }
    out.set(listing.id, hold)
    out.set(listing.key, hold)
  }
  return out
}

/** Where a Tool from outside the space came from — the muted line in its band. Null for the space's own. */
function provenanceOf(row: InstallRow, holds: HoldLookup): InstalledToolDto['provenance'] {
  if (!isForeign(row)) return null
  const hold = holds.get(holdKey(row))
  return { publisher: hold?.publisher ?? null, reviewed: row.version.marketplaceStatus === 'approved', verified: hold?.verified ?? false }
}

/** Why this install is not running, when it was pulled back; null when it runs. */
function stoppedOf(row: InstallRow, holds: HoldLookup): string | null {
  const denial = runDenial({
    version: row.version,
    listing: holds.get(holdKey(row)) ?? null,
    sourceSpaceId: row.version.sourceSpaceId,
    installSpaceId: row.spaceId,
    sharedFromSpaceId: row.sharedFromSpaceId,
  })
  return denial?.message ?? null
}

/** A pending upgrade, resolved to the diff an admin is being asked to approve. */
type PendingLookup = ReadonlyMap<string, { id: string; version: number; perimeter: unknown }>

function toSummary(row: InstallRow, pending: PendingLookup, holds: HoldLookup): InstallSummary {
  const { config, manifest, values } = boundVersion(row.version.config, row.version.name, row.bindings)
  const requirements = parseRequirements(row.requirements)
  const upgrade = row.pendingVersionId ? pending.get(row.pendingVersionId) : undefined
  return {
    id: row.id,
    key: row.key,
    slug: row.slug,
    title: row.version.title,
    description: row.version.description,
    version: row.version.version,
    enabled: row.enabled,
    requirements,
    degraded: isDegraded(requirements),
    typeClaims: parseTypeClaims(row.typeClaims),
    rail: config.surfaces.rail,
    types: config.surfaces.types,
    sharedFrom: row.sharedFromSpace,
    stopped: stoppedOf(row, holds),
    provenance: provenanceOf(row, holds),
    slots: manifest.bindings,
    bindings: values,
    settingSpecs: manifest.settings,
    settings: declaredSettings(row.settings, manifest),
    collections: Object.keys(manifest.collections),
    pendingVersion: upgrade
      ? {
          id: upgrade.id,
          version: upgrade.version,
          // Against the version this space is RUNNING, not against the previous
          // approved one: "what changes for me if I upgrade" is the question.
          perimeterDiff: diffPerimeter(
            decodeToolPerimeter(row.version.perimeter),
            decodeToolPerimeter(upgrade.perimeter),
          ),
        }
      : null,
  }
}

/** Resolve the pending versions a batch of installs points at, in one query. */
async function pendingFor(rows: readonly InstallRow[]): Promise<PendingLookup> {
  const ids = [...new Set(rows.map((row) => row.pendingVersionId).filter((id): id is string => id !== null))]
  if (ids.length === 0) return new Map()
  const versions = await prisma.appToolVersion.findMany({
    // `pendingVersionId` is deliberately not a foreign key, and a withdrawn
    // version is no longer an offer, so both cases resolve to "no upgrade".
    where: { id: { in: ids }, status: 'approved', revokedAt: null },
    select: { id: true, version: true, perimeter: true },
  })
  return new Map(versions.map((version) => [version.id, version]))
}

async function summarise(rows: readonly InstallRow[]): Promise<InstallSummary[]> {
  const [pending, holds] = await Promise.all([pendingFor(rows), holdsFor(rows)])
  return rows.map((row) => toSummary(row, pending, holds))
}

async function loadInstall(spaceId: string, installId: string): Promise<InstallRow | null> {
  return prisma.appToolInstall.findFirst({
    where: { id: installId, spaceId },
    select: INSTALL_SELECT,
  })
}

// ── reads ────────────────────────────────────────────────────────────────────

/** Every Tool this space runs, by slug — the Installed tab and the console. */
export async function listInstalls(spaceId: string): Promise<InstallSummary[]> {
  const rows = await prisma.appToolInstall.findMany({
    where: { spaceId },
    orderBy: { slug: 'asc' },
    select: INSTALL_SELECT,
  })
  return summarise(rows)
}

/** One install row → the space-DTO slice: enough to draw the rail row, route
 *  `/t/<slug>` and dispatch a type page, with no perimeter, requirements detail
 *  or version history. */
function toClientDto(row: InstallRow, holds: HoldLookup): InstalledToolDto {
  const config = decodeToolConfig(row.version.config, row.version.name)
  const requirements = parseRequirements(row.requirements)
  return {
    id: row.id,
    key: row.key,
    slug: row.slug,
    title: row.version.title,
    icon: config.surfaces.rail?.icon ?? null,
    iconSvg: row.version.iconSvg,
    label: config.surfaces.rail?.label ?? null,
    href: `/t/${row.slug}`,
    enabled: row.enabled,
    degraded: isDegraded(requirements),
    types: parseTypeClaims(row.typeClaims),
    sharedFrom: row.sharedFromSpace,
    stopped: stoppedOf(row, holds),
    name: row.version.name,
    version: row.version.version,
    nav: config.surfaces.nav ?? null,
    actions: config.surfaces.actions ?? [],
    provenance: provenanceOf(row, holds),
  }
}

/**
 * The same slice for many spaces in ONE query — what `lib/spaces/queries.ts`
 * hangs on every Space it serializes for the client.
 *
 * ENABLED installs only: this list is what draws the sidebar rail rows and
 * routes `/t/<slug>`, and a disabled install has neither. The console reads
 * `listInstalls`, which still sees them.
 */
export async function installedToolsForSpaces(
  spaceIds: readonly string[],
): Promise<Map<string, InstalledToolDto[]>> {
  const out = new Map<string, InstalledToolDto[]>()
  if (spaceIds.length === 0) return out
  const rows = await prisma.appToolInstall.findMany({
    where: { spaceId: { in: [...spaceIds] }, enabled: true },
    // Stable and space-independent: the rail's own order comes from
    // `featureConfig.order`, so this only has to be the same every time.
    orderBy: [{ spaceId: 'asc' }, { slug: 'asc' }],
    select: INSTALL_SELECT,
  })
  const holds = await holdsFor(rows)
  for (const row of rows) {
    const list = out.get(row.spaceId)
    if (list) list.push(toClientDto(row, holds))
    else out.set(row.spaceId, [toClientDto(row, holds)])
  }
  return out
}

// ── install ──────────────────────────────────────────────────────────────────

async function refuseNonAdmin(
  spaceId: string,
  actor: { userId: string; email: string },
  act: string,
): Promise<RegistryError | null> {
  if (await isAdmin(actor.userId, spaceId, actor.email)) return null
  return { ok: false, status: 403, error: `Only space admins can ${act}.` }
}

/** Thrown inside an updateSpaceConfig callback to roll the whole install back. */
class InstallRefusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'InstallRefusal'
  }
}

/**
 * Install an approved version into a space.
 *
 * Order of business: check the admin, check the version, work out what the space
 * can satisfy, then — inside the space's config lock — pick a free slug, resolve
 * the type claims against the installs already there, write the row and place
 * the rail item. The lock is what makes the last three safe: two admins
 * installing at the same moment cannot land the same slug or both own a type's
 * page.
 *
 * Unmet requirements do NOT refuse. The Tool installs, `degraded` is true, and
 * the admin reads the checklist — that is the brief's rule, and the alternative
 * is a marketplace where nothing installs until the space looks like the
 * author's.
 */
export async function installVersion(
  spaceId: string,
  versionId: string,
  actor: { userId: string; email: string },
  opts: {
    slug?: string
    typeClaims?: Record<string, TypeClaimChoice>
    /** Where its rail row goes: on the rail (the default) or tucked into More. */
    placement?: 'rail' | 'more'
    /** What each binding slot is bound to here. The source space's own default to their suggestions. */
    bindings?: BindingValues
    /** The install's settings; unset ones take their defaults. */
    settings?: Record<string, unknown>
  } = {},
): Promise<InstallResult> {
  const refusal = await refuseNonAdmin(spaceId, actor, 'install a tool')
  if (refusal) return refusal

  const version = await prisma.appToolVersion.findUnique({
    where: { id: versionId },
    select: {
      id: true,
      key: true,
      name: true,
      status: true,
      marketplaceStatus: true,
      sourceSpaceId: true,
      config: true,
      perimeter: true,
      revokedAt: true,
      listingId: true,
    },
  })
  if (!version) return { ok: false, status: 404, error: 'No such tool version.' }
  const listing =
    version.sourceSpaceId === spaceId ? null : await listingHoldFor({ listingId: version.listingId, key: version.key })
  // The two verdicts, applied. A space's own approval reaches that space;
  // outside it, only a marketplace listing will do — which is what keeps a Tool
  // written in a private space out of everyone else's reach.
  const allowed = installability({
    status: decodeVersionStatus(version.status),
    marketplaceStatus: version.marketplaceStatus ? decodeVersionStatus(version.marketplaceStatus) : null,
    sourceSpaceId: version.sourceSpaceId,
    spaceId,
    revoked: version.revokedAt !== null,
    listingState: listing?.state ?? null,
  })
  if (!allowed.ok) return { ok: false, status: 403, error: allowed.error }
  // A new listing reaches a bounded number of spaces while it is staged.
  if (version.sourceSpaceId !== spaceId && version.listingId) {
    const staged = await stagedInstallRefusal(version.listingId, spaceId)
    if (staged) return { ok: false, status: 403, error: staged }
  }

  const facts = await spaceFactsForActor(spaceId, actor.userId)
  if (!facts) return { ok: false, status: 403, error: 'You are not a member of this space.' }
  // Each slot bound to a thing of this space's own: what the admin chose, else
  // the Tool's suggestion when this space has it — so in the space that wrote
  // it, nobody binds anything. What is left runs degraded until bound.
  const declared = manifestOf(decodeToolConfig(version.config, version.name))
  let bindingValues: BindingValues = {}
  if (Object.keys(declared.bindings).length > 0 || Object.keys(opts.bindings ?? {}).length > 0) {
    const planned = planBindings(declared, opts.bindings ?? {}, await bindableSpace(spaceId))
    if (!planned.ok) return { ok: false, status: 400, error: planned.error }
    bindingValues = planned.value
  }
  const settings = planSettings(declared, opts.settings ?? {})
  if (!settings.ok) return { ok: false, status: 400, error: settings.error }
  const bound = boundVersion(version.config, version.name, bindingValues)
  const config = bound.config
  const requirements = boundRequirements(bound.manifest, bound.values, facts.available)

  const requestedSlug = opts.slug?.trim().toLowerCase() || version.name
  if (!TOOL_NAME_RE.test(requestedSlug)) {
    return {
      ok: false,
      status: 400,
      error: 'A tool slug is lower-case letters, digits and hyphens (63 max).',
    }
  }

  // A holder rather than two `let`s: the assignments happen inside a callback,
  // where narrowing from an initialiser would leave them typed `null` after it.
  const out: { created?: InstallRow; resolution?: TypeClaimResolution } = {}
  try {
    await updateSpaceConfig(spaceId, async (stored, tx) => {
      const siblings = await tx.appToolInstall.findMany({
        where: { spaceId },
        select: { key: true, slug: true, typeClaims: true, listingId: true },
      })
      if (siblings.some((row) => row.key === version.key || (version.listingId && row.listingId === version.listingId))) {
        throw new InstallRefusal(409, 'This tool is already installed in this space.')
      }
      const slug = uniqueSlug(requestedSlug, new Set(siblings.map((row) => row.slug)))
      const resolution = resolveTypeClaims(requestedClaims(bound.claims, opts.typeClaims), {
        customTypes: facts.customTypes,
        pageOwners: pageOwnersOf(siblings),
      })
      out.resolution = resolution
      out.created = await tx.appToolInstall.create({
        data: {
          spaceId,
          versionId,
          key: version.key,
          slug,
          installedBy: actor.userId,
          requirements: requirements as unknown as object,
          typeClaims: resolution.claims as unknown as object,
          bindings: bindingValues as unknown as object,
          settings: settings.value as unknown as object,
          listingId: version.listingId,
        },
        select: INSTALL_SELECT,
      })
      await adoptRows(spaceId, out.created.id, { key: version.key, listingId: version.listingId }, tx)
      if (!config.surfaces.rail) return {}
      return { featureConfig: featureConfigWithRail(stored.featureConfig, toolRailKey(slug), opts.placement) }
    })
  } catch (err) {
    return refusalOf(err)
  }
  if (!out.created || !out.resolution) {
    return { ok: false, status: 500, error: 'The install did not complete.' }
  }
  void logAudit(spaceId, {
    userId: actor.userId,
    name: actor.email,
    action: 'tool',
    path: `tools/${out.created.slug}`,
    detail: `installed ${version.key} as ${out.created.slug}`,
  })

  // A house installing its OWN Tool sets the version its rooms run
  // (lib/tools/share.ts) — re-derived here so a room never runs a version the
  // house has moved off.
  if (version.sourceSpaceId === spaceId) void followInRooms(spaceId, version.name)

  const [summary] = await summarise([out.created])
  return {
    ok: true,
    install: summary,
    downgraded: out.resolution.downgraded,
    conflicts: out.resolution.conflicts,
  }
}

/** The rooms' shared copies follow the house's version — dynamic, share.ts imports this module. */
async function followInRooms(houseId: string, name: string): Promise<void> {
  const share = await import('./share')
  await share.syncSharedToolInstallsQuietly(houseId, name)
}

/**
 * The modes to resolve: what the Tool declared, overridden by the admin's pick.
 * A claim the admin answered `none` is left out.
 */
export function requestedClaims(
  declared: readonly ToolTypeSurface[],
  override: Record<string, TypeClaimChoice> | undefined,
): ToolTypeSurface[] {
  return declared.flatMap((claim) => {
    const asked = override?.[claim.type]
    if (asked === 'none') return []
    return [asked ? { type: claim.type, mode: asked } : claim]
  })
}

/** type → slug of the install owning its page, for the one-page-per-type rule. */
function pageOwnersOf(
  rows: readonly { slug: string; typeClaims: unknown }[],
): ReadonlyMap<string, string> {
  const out = new Map<string, string>()
  for (const row of rows) {
    for (const [type, mode] of Object.entries(parseTypeClaims(row.typeClaims))) {
      if (mode === 'page' && !out.has(type)) out.set(type, row.slug)
    }
  }
  return out
}

function refusalOf(err: unknown): RegistryError {
  if (err instanceof InstallRefusal) return { ok: false, status: err.status, error: err.message }
  if (err instanceof UnknownSpaceError) return { ok: false, status: 404, error: 'No such space.' }
  throw err
}

/**
 * Remove an install: the row, and the Tool's rail key from `order`, `more` and
 * `adminOnly`. One transaction, so a space never keeps a rail row pointing at a
 * `/t/<slug>` that 404s.
 *
 * `AppToolState` rows (the Tool's per-install KV) cascade with the row, which is
 * the intended reading of uninstall: the Tool's own stored state is its, and it
 * goes with it. Its collections' rows are detached rather than dropped, for
 * the same Tool installed here again to take back (lib/tools/collections.ts).
 * Context notes it wrote are the space's and stay.
 */
export async function uninstall(
  spaceId: string,
  installId: string,
  actor: { userId: string; email: string },
): Promise<UninstallResult> {
  const refusal = await refuseNonAdmin(spaceId, actor, 'uninstall a tool')
  if (refusal) return refusal
  const install = await loadInstall(spaceId, installId)
  if (!install) return { ok: false, status: 404, error: 'No such install.' }
  if (install.sharedFromSpace) {
    return {
      ok: false,
      status: 403,
      error: `This tool is shared from ${install.sharedFromSpace.name}. Stop sharing it there, or turn it off here.`,
    }
  }

  try {
    await updateSpaceConfig(spaceId, async (stored, tx) => {
      // deleteMany, so a row another admin removed while we waited on the lock is
      // a no-op rather than a 500 — and the space scope is re-checked inside it.
      const removed = await tx.appToolInstall.deleteMany({ where: { id: installId, spaceId } })
      if (removed.count > 0) await detachRows(installId, tx)
      return { featureConfig: featureConfigWithoutRail(stored.featureConfig, toolRailKey(install.slug)) }
    })
  } catch (err) {
    return refusalOf(err)
  }
  void logAudit(spaceId, {
    userId: actor.userId,
    name: actor.email,
    action: 'tool',
    path: `tools/${install.slug}`,
    detail: `uninstalled ${install.key} (${install.slug})`,
  })
  return { ok: true }
}

/**
 * Drop a space's install of a Tool IT AUTHORED, rail key included — the
 * system-level half of `uninstall`, with no admin gate and no refusals.
 *
 * This is what connects the two deletion doors: deleting the working copy
 * (lib/tools/service.ts#deleteTool, or trashing `tools/<name>/index.md`
 * straight from the context — lib/tools/hooks.ts#toolNoteDeleted) must not
 * leave the console showing an install of a Tool whose author threw it away.
 * The note deletion that gets us here was already held to `canRemove`, which
 * is the bar that matters. A no-op when the space never installed its own
 * Tool. Only ever THIS space's install — other spaces run the published
 * snapshot and keep it.
 */
export async function removeInstallForTool(spaceId: string, name: string): Promise<void> {
  // What its previews kept goes with the working copy.
  await dropPreviewRows(spaceId, name)
  const install = await prisma.appToolInstall.findUnique({
    where: { app_tool_install_identity: { spaceId, key: toolKey(spaceId, name) } },
    select: { id: true, slug: true },
  })
  if (!install) return
  await updateSpaceConfig(spaceId, async (stored, tx) => {
    await tx.appToolInstall.deleteMany({ where: { id: install.id, spaceId } })
    await detachRows(install.id, tx)
    return { featureConfig: featureConfigWithoutRail(stored.featureConfig, toolRailKey(install.slug)) }
  })
}

/** The admin's on/off switch for one install. The rail key stays put, so the
 *  Tool comes back where it was. */
export async function setInstallEnabled(
  spaceId: string,
  installId: string,
  actor: { userId: string; email: string },
  enabled: boolean,
): Promise<InstallUpdateResult> {
  const refusal = await refuseNonAdmin(spaceId, actor, 'enable or disable a tool')
  if (refusal) return refusal
  const install = await loadInstall(spaceId, installId)
  if (!install) return { ok: false, status: 404, error: 'No such install.' }
  const updated = await prisma.appToolInstall.update({
    where: { id: installId },
    data: { enabled },
    select: INSTALL_SELECT,
  })
  void logAudit(spaceId, {
    userId: actor.userId,
    name: actor.email,
    action: 'tool',
    path: `tools/${install.slug}`,
    detail: `${enabled ? 'enabled' : 'disabled'} ${install.slug}`,
  })
  const [summary] = await summarise([updated])
  return { ok: true, install: summary }
}

/**
 * Set which types this install owns, and how — the admin's answer to a conflict
 * the install reported.
 *
 * Only types the pinned version DECLARED may be claimed: a claim the Tool never
 * asked for would give it a surface its own perimeter may not even cover. A
 * `page` on a type another install owns is refused rather than resolved, with
 * both sides named, because taking a page away from a working Tool is a decision
 * and not a merge.
 */
export async function setTypeClaims(
  spaceId: string,
  installId: string,
  actor: { userId: string; email: string },
  claims: TypeClaims,
): Promise<InstallUpdateResult> {
  const refusal = await refuseNonAdmin(spaceId, actor, 'change a tool’s type pages')
  if (refusal) return refusal
  const install = await loadInstall(spaceId, installId)
  if (!install) return { ok: false, status: 404, error: 'No such install.' }

  const bound = boundVersion(install.version.config, install.version.name, install.bindings)
  const declared = new Set(bound.claims.map((claim) => claim.type))
  const unknown = Object.keys(claims)
    .map((type) => type.trim().toLowerCase())
    .filter((type) => !declared.has(type))
  if (unknown.length > 0) {
    return {
      ok: false,
      status: 400,
      error: `${install.version.title} does not declare the type${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')}.`,
    }
  }

  const facts = await spaceFactsForActor(spaceId, actor.userId)
  if (!facts) return { ok: false, status: 403, error: 'You are not a member of this space.' }

  const out: { updated?: InstallRow } = {}
  try {
    await updateSpaceConfig(spaceId, async (stored, tx) => {
      void stored // the claims live on the install row; no featureConfig change
      const siblings = await tx.appToolInstall.findMany({
        where: { spaceId, id: { not: installId } },
        select: { slug: true, typeClaims: true },
      })
      const resolution = resolveTypeClaims(
        // Only the types the admin named change; the rest keep the mode they have.
        requestedClaims(bound.claims, { ...parseTypeClaims(install.typeClaims), ...claims }),
        { customTypes: facts.customTypes, pageOwners: pageOwnersOf(siblings) },
      )
      if (resolution.conflicts.length > 0) {
        const first = resolution.conflicts[0]
        throw new InstallRefusal(
          409,
          `The ${first.type} page is already owned by ${first.heldBy} — uninstall or re-point that tool first.`,
        )
      }
      out.updated = await tx.appToolInstall.update({
        where: { id: installId },
        data: { typeClaims: resolution.claims as unknown as object },
        select: INSTALL_SELECT,
      })
      return {}
    })
  } catch (err) {
    return refusalOf(err)
  }
  if (!out.updated) return { ok: false, status: 500, error: 'The claim change did not complete.' }
  void logAudit(spaceId, {
    userId: actor.userId,
    name: actor.email,
    action: 'tool',
    path: `tools/${install.slug}`,
    detail: `type claims changed on ${install.slug}: ${Object.entries(claims)
      .map(([type, mode]) => `${type}=${mode}`)
      .join(', ')}`,
  })
  const [summary] = await summarise([out.updated])
  return { ok: true, install: summary }
}

/**
 * Bind an install's slots and set its settings — install data, an admin's,
 * audited. A slot or setting named replaces its value, an empty one clears an
 * optional slot, and the rest keep theirs. The reach is re-bound, so its
 * requirements are re-checked and a `$type` page follows its slot.
 */
export async function setInstallBindings(
  spaceId: string,
  installId: string,
  actor: { userId: string; email: string },
  patch: { bindings?: BindingValues; settings?: Record<string, unknown> },
): Promise<InstallUpdateResult> {
  const refusal = await refuseNonAdmin(spaceId, actor, 'bind a tool')
  if (refusal) return refusal
  const install = await loadInstall(spaceId, installId)
  if (!install) return { ok: false, status: 404, error: 'No such install.' }

  const current = boundVersion(install.version.config, install.version.name, install.bindings)
  const planned = planBindings(current.manifest, patch.bindings ?? {}, await bindableSpace(spaceId), current.values)
  if (!planned.ok) return { ok: false, status: 400, error: planned.error }
  const settings = planSettings(current.manifest, { ...declaredSettings(install.settings, current.manifest), ...(patch.settings ?? {}) })
  if (!settings.ok) return { ok: false, status: 400, error: settings.error }
  const facts = await spaceFactsForActor(spaceId, actor.userId)
  if (!facts) return { ok: false, status: 403, error: 'You are not a member of this space.' }

  const bound = boundVersion(install.version.config, install.version.name, planned.value)
  const requirements = boundRequirements(bound.manifest, bound.values, facts.available)
  const out: { updated?: InstallRow } = {}
  try {
    await updateSpaceConfig(spaceId, async (stored, tx) => {
      void stored // bindings, settings and claims all live on the install row
      const siblings = await tx.appToolInstall.findMany({
        where: { spaceId, id: { not: installId } },
        select: { slug: true, typeClaims: true },
      })
      const moved = followRebound(parseTypeClaims(install.typeClaims), current.claims, bound.claims)
      // A shared-down install claims nothing (lib/tools/share.ts), so only a room's own is resolved again.
      const typeClaims = install.sharedFromSpaceId
        ? moved
        : resolveTypeClaims(requestedClaims(bound.claims, moved), {
            customTypes: facts.customTypes,
            pageOwners: pageOwnersOf(siblings),
          }).claims
      out.updated = await tx.appToolInstall.update({
        where: { id: installId },
        data: {
          bindings: planned.value as unknown as object,
          settings: settings.value as unknown as object,
          requirements: requirements as unknown as object,
          typeClaims: typeClaims as unknown as object,
        },
        select: INSTALL_SELECT,
      })
      return {}
    })
  } catch (err) {
    return refusalOf(err)
  }
  if (!out.updated) return { ok: false, status: 500, error: 'The binding change did not complete.' }
  const changed = [
    ...Object.keys(patch.bindings ?? {}).map((slot) => `${slot}=${planned.value[slot] ?? '(unbound)'}`),
    ...Object.keys(patch.settings ?? {}).map((key) => `setting ${key}`),
  ]
  void logAudit(spaceId, {
    userId: actor.userId,
    name: actor.email,
    action: 'tool',
    path: `tools/${install.slug}`,
    detail: `bound ${install.slug}${changed.length ? `: ${changed.join(', ')}` : ''}`,
  })
  const [summary] = await summarise([out.updated])
  return { ok: true, install: summary }
}

/**
 * Move an install onto the approved version waiting for it.
 *
 * This is the only way a space's Tool code changes, and it is always an admin
 * pressing a button after reading the perimeter diff. Requirements are
 * recomputed (the new version may declare a connector this space hasn't got) and
 * the type claims re-resolved (it may claim a type the old one didn't); the rail
 * key follows the new config, so a version that drops its rail row loses it.
 */
export async function applyUpgrade(
  spaceId: string,
  installId: string,
  actor: { userId: string; email: string },
): Promise<InstallUpdateResult> {
  const refusal = await refuseNonAdmin(spaceId, actor, 'upgrade a tool')
  if (refusal) return refusal
  const install = await loadInstall(spaceId, installId)
  if (!install) return { ok: false, status: 404, error: 'No such install.' }
  if (install.sharedFromSpace) {
    return {
      ok: false,
      status: 403,
      error: `This tool is shared from ${install.sharedFromSpace.name} and follows the version it runs there.`,
    }
  }
  if (!install.pendingVersionId) {
    return { ok: false, status: 409, error: 'There is no upgrade waiting for this tool.' }
  }

  const next = await prisma.appToolVersion.findUnique({
    where: { id: install.pendingVersionId },
    select: {
      id: true,
      key: true,
      name: true,
      version: true,
      status: true,
      marketplaceStatus: true,
      sourceSpaceId: true,
      config: true,
      perimeter: true,
      revokedAt: true,
      listingId: true,
    },
  })
  const nextListing =
    next && next.sourceSpaceId !== spaceId ? await listingHoldFor({ listingId: next.listingId, key: next.key }) : null
  // Re-asked rather than trusted: the offer was written when the version was
  // approved, and a listing can be rejected or a space verdict reversed in
  // between. The same rule as a fresh install, because that is what this is.
  // It is this Tool's upgrade when it has the same key, or — after the listing
  // moved to another publisher — the same listing.
  const sameTool = !!next && (next.key === install.key || (!!next.listingId && next.listingId === install.listingId))
  const offered =
    next && sameTool
      ? installability({
          status: decodeVersionStatus(next.status),
          marketplaceStatus: next.marketplaceStatus ? decodeVersionStatus(next.marketplaceStatus) : null,
          sourceSpaceId: next.sourceSpaceId,
          spaceId,
          revoked: next.revokedAt !== null,
          listingState: nextListing?.state ?? null,
        })
      : { ok: false as const }
  if (!next || !offered.ok) {
    // The offer went away (withdrawn, delisted, or a key that isn't this
    // Tool's). Clear it rather than leaving a button that always fails.
    await prisma.appToolInstall.update({ where: { id: installId }, data: { pendingVersionId: null } })
    return { ok: false, status: 409, error: 'That upgrade is no longer available.' }
  }

  // The install's bindings carry over while they still fit; a slot the new
  // version adds takes its suggestion when this space has it, or runs
  // degraded until an admin binds it.
  const nextManifest = manifestOf(decodeToolConfig(next.config, next.name))
  const bindingValues = Object.keys(nextManifest.bindings).length
    ? defaultBindings(nextManifest, await bindableSpace(spaceId), bindingValuesOf(install.bindings))
    : {}
  const bound = boundVersion(next.config, next.name, bindingValues)
  const config = bound.config
  const facts = await spaceFactsForActor(spaceId, actor.userId)
  if (!facts) return { ok: false, status: 403, error: 'You are not a member of this space.' }
  const requirements = boundRequirements(bound.manifest, bound.values, facts.available)

  const out: { updated?: InstallRow } = {}
  try {
    await updateSpaceConfig(spaceId, async (stored, tx) => {
      const siblings = await tx.appToolInstall.findMany({
        where: { spaceId, id: { not: installId } },
        select: { slug: true, typeClaims: true },
      })
      const resolution = resolveTypeClaims(
        requestedClaims(bound.claims, parseTypeClaims(install.typeClaims)),
        { customTypes: facts.customTypes, pageOwners: pageOwnersOf(siblings) },
      )
      out.updated = await tx.appToolInstall.update({
        where: { id: installId },
        data: {
          versionId: next.id,
          // The listing's new publisher names the Tool by its own key.
          key: next.key,
          listingId: next.listingId ?? install.listingId,
          requirements: requirements as unknown as object,
          typeClaims: resolution.claims as unknown as object,
          bindings: bindingValues as unknown as object,
          pendingVersionId: null,
        },
        select: INSTALL_SELECT,
      })
      const key = toolRailKey(install.slug)
      const had = (stored.featureConfig.order ?? []).includes(key)
      if (config.surfaces.rail && !had) {
        return {
          featureConfig: mergeFeatureConfig(stored.featureConfig, {
            order: orderWithRail(stored.featureConfig, key),
            enabled: { [key]: true },
          }),
        }
      }
      if (!config.surfaces.rail && had) {
        return { featureConfig: featureConfigWithoutRail(stored.featureConfig, key) }
      }
      return {}
    })
  } catch (err) {
    return refusalOf(err)
  }
  if (!out.updated) return { ok: false, status: 500, error: 'The upgrade did not complete.' }
  void logAudit(spaceId, {
    userId: actor.userId,
    name: actor.email,
    action: 'tool',
    path: `tools/${install.slug}`,
    detail: `upgraded to v${next.version}`,
  })
  const [summary] = await summarise([out.updated])
  if (next.sourceSpaceId === spaceId) void followInRooms(spaceId, next.name)
  return { ok: true, install: summary }
}

/**
 * Re-check every install's requirements against the space as it stands now — the
 * "Re-check" button behind a degraded banner.
 *
 * Nothing calls this automatically. A connector being added should clear a
 * banner, but a sweep on every connector/type/agent write would put a table
 * write in the path of every note save; an admin asking is cheap and honest.
 * Rows whose answer hasn't changed are not rewritten.
 */
export async function refreshRequirements(
  spaceId: string,
  actor: { userId: string; email: string },
): Promise<RefreshResult> {
  const refusal = await refuseNonAdmin(spaceId, actor, 're-check tool requirements')
  if (refusal) return refusal
  const facts = await spaceFactsForActor(spaceId, actor.userId)
  if (!facts) return { ok: false, status: 403, error: 'You are not a member of this space.' }

  const rows = await prisma.appToolInstall.findMany({
    where: { spaceId },
    orderBy: { slug: 'asc' },
    select: INSTALL_SELECT,
  })
  const fresh: InstallRow[] = []
  for (const row of rows) {
    const bound = boundVersion(row.version.config, row.version.name, row.bindings)
    const requirements = boundRequirements(bound.manifest, bound.values, facts.available)
    if (requirementsEqual(requirements, parseRequirements(row.requirements))) {
      fresh.push(row)
      continue
    }
    fresh.push(
      await prisma.appToolInstall.update({
        where: { id: row.id },
        data: { requirements: requirements as unknown as object },
        select: INSTALL_SELECT,
      }),
    )
  }
  return { ok: true, installs: await summarise(fresh) }
}
