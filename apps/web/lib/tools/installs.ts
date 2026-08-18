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
import { TOOL_NAME_RE, type ToolTypeSurface } from './config'
import { diffPerimeter, type PerimeterDiff } from './perimeter'
import { decodeToolConfig, decodeToolPerimeter, type RegistryError } from './registry'
import {
  computeRequirements,
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
}

/**
 * The installed-Tools slice of the space DTO — what the sidebar, the `/t/<slug>`
 * page and the type-page dispatch need on every render, and nothing more.
 * `icon`/`label` are null for a Tool with no rail row (it lives on a type page).
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
  label: string | null
  href: string
  enabled: boolean
  degraded: boolean
  types: TypeClaims
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
      // Model connectors name an LLM provider and are never runnable, so a Tool
      // declaring one has nothing it could call (lib/connectors/service.ts).
      connectors: connectors.filter((c) => c.kind !== 'model').map((c) => c.name),
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
function orderWithRail(config: SpaceFeatureConfig, key: string): string[] {
  const current = config.order ?? []
  const base =
    current.length > 0
      ? current
      : ALL_FEATURE_KEYS.filter((feature) => !NAV_HIDDEN_FEATURE_KEYS.includes(feature))
  return base.includes(key) ? [...base] : [...base, key]
}

/** The same three lists with a Tool's rail key taken out of all of them. */
function featureConfigWithoutRail(config: SpaceFeatureConfig, key: string): SpaceFeatureConfig {
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

// ── row → DTO ────────────────────────────────────────────────────────────────

const INSTALL_SELECT = {
  id: true,
  key: true,
  slug: true,
  enabled: true,
  requirements: true,
  typeClaims: true,
  pendingVersionId: true,
  version: {
    select: {
      id: true,
      name: true,
      version: true,
      title: true,
      description: true,
      config: true,
      perimeter: true,
    },
  },
} as const

interface InstallRow {
  id: string
  key: string
  slug: string
  enabled: boolean
  requirements: unknown
  typeClaims: unknown
  pendingVersionId: string | null
  version: {
    id: string
    name: string
    version: number
    title: string
    description: string | null
    config: unknown
    perimeter: unknown
  }
}

/** A pending upgrade, resolved to the diff an admin is being asked to approve. */
type PendingLookup = ReadonlyMap<string, { id: string; version: number; perimeter: unknown }>

function toSummary(row: InstallRow, pending: PendingLookup): InstallSummary {
  const config = decodeToolConfig(row.version.config, row.version.name)
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
    where: { id: { in: ids }, status: 'approved' },
    select: { id: true, version: true, perimeter: true },
  })
  return new Map(versions.map((version) => [version.id, version]))
}

async function summarise(rows: readonly InstallRow[]): Promise<InstallSummary[]> {
  const pending = await pendingFor(rows)
  return rows.map((row) => toSummary(row, pending))
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
function toClientDto(row: InstallRow): InstalledToolDto {
  const config = decodeToolConfig(row.version.config, row.version.name)
  const requirements = parseRequirements(row.requirements)
  return {
    id: row.id,
    key: row.key,
    slug: row.slug,
    title: row.version.title,
    icon: config.surfaces.rail?.icon ?? null,
    label: config.surfaces.rail?.label ?? null,
    href: `/t/${row.slug}`,
    enabled: row.enabled,
    degraded: isDegraded(requirements),
    types: parseTypeClaims(row.typeClaims),
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
    select: { ...INSTALL_SELECT, spaceId: true },
  })
  for (const row of rows) {
    const list = out.get(row.spaceId)
    if (list) list.push(toClientDto(row))
    else out.set(row.spaceId, [toClientDto(row)])
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
  opts: { slug?: string; typeClaims?: TypeClaims } = {},
): Promise<InstallResult> {
  const refusal = await refuseNonAdmin(spaceId, actor, 'install a tool')
  if (refusal) return refusal

  const version = await prisma.appToolVersion.findUnique({
    where: { id: versionId },
    select: { id: true, key: true, name: true, status: true, config: true, perimeter: true },
  })
  if (!version) return { ok: false, status: 404, error: 'No such tool version.' }
  if (version.status !== 'approved') {
    return { ok: false, status: 400, error: 'Only an approved version can be installed.' }
  }

  const config = decodeToolConfig(version.config, version.name)
  const facts = await spaceFactsForActor(spaceId, actor.userId)
  if (!facts) return { ok: false, status: 403, error: 'You are not a member of this space.' }
  const requirements = computeRequirements(decodeToolPerimeter(version.perimeter), facts.available)

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
        select: { key: true, slug: true, typeClaims: true },
      })
      if (siblings.some((row) => row.key === version.key)) {
        throw new InstallRefusal(409, 'This tool is already installed in this space.')
      }
      const slug = uniqueSlug(requestedSlug, new Set(siblings.map((row) => row.slug)))
      const resolution = resolveTypeClaims(requestedClaims(config.surfaces.types, opts.typeClaims), {
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
        },
        select: INSTALL_SELECT,
      })
      if (!config.surfaces.rail) return {}
      const key = toolRailKey(slug)
      return {
        featureConfig: mergeFeatureConfig(stored.featureConfig, {
          order: orderWithRail(stored.featureConfig, key),
          // Explicitly on, so a re-install never inherits an old "off" from a
          // space that had this slug before.
          enabled: { [key]: true },
        }),
      }
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

  const [summary] = await summarise([out.created])
  return {
    ok: true,
    install: summary,
    downgraded: out.resolution.downgraded,
    conflicts: out.resolution.conflicts,
  }
}

/** The modes to resolve: what the Tool declared, overridden by the admin's pick. */
function requestedClaims(
  declared: readonly ToolTypeSurface[],
  override: TypeClaims | undefined,
): ToolTypeSurface[] {
  return declared.map((claim) => {
    const asked = override?.[claim.type]
    return asked ? { type: claim.type, mode: asked } : claim
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
 * goes with it. Context notes it wrote are the space's and stay.
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

  try {
    await updateSpaceConfig(spaceId, async (stored, tx) => {
      // deleteMany, so a row another admin removed while we waited on the lock is
      // a no-op rather than a 500 — and the space scope is re-checked inside it.
      await tx.appToolInstall.deleteMany({ where: { id: installId, spaceId } })
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

  const config = decodeToolConfig(install.version.config, install.version.name)
  const declared = new Set(config.surfaces.types.map((claim) => claim.type))
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
        requestedClaims(config.surfaces.types, { ...parseTypeClaims(install.typeClaims), ...claims }),
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
  if (!install.pendingVersionId) {
    return { ok: false, status: 409, error: 'There is no upgrade waiting for this tool.' }
  }

  const next = await prisma.appToolVersion.findUnique({
    where: { id: install.pendingVersionId },
    select: { id: true, key: true, name: true, version: true, status: true, config: true, perimeter: true },
  })
  if (!next || next.status !== 'approved' || next.key !== install.key) {
    // The offer went away (withdrawn, or a key that isn't this Tool's). Clear it
    // rather than leaving an upgrade button that always fails.
    await prisma.appToolInstall.update({ where: { id: installId }, data: { pendingVersionId: null } })
    return { ok: false, status: 409, error: 'That upgrade is no longer available.' }
  }

  const config = decodeToolConfig(next.config, next.name)
  const facts = await spaceFactsForActor(spaceId, actor.userId)
  if (!facts) return { ok: false, status: 403, error: 'You are not a member of this space.' }
  const requirements = computeRequirements(decodeToolPerimeter(next.perimeter), facts.available)

  const out: { updated?: InstallRow } = {}
  try {
    await updateSpaceConfig(spaceId, async (stored, tx) => {
      const siblings = await tx.appToolInstall.findMany({
        where: { spaceId, id: { not: installId } },
        select: { slug: true, typeClaims: true },
      })
      const resolution = resolveTypeClaims(
        requestedClaims(config.surfaces.types, parseTypeClaims(install.typeClaims)),
        { customTypes: facts.customTypes, pageOwners: pageOwnersOf(siblings) },
      )
      out.updated = await tx.appToolInstall.update({
        where: { id: installId },
        data: {
          versionId: next.id,
          requirements: requirements as unknown as object,
          typeClaims: resolution.claims as unknown as object,
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
    const requirements = computeRequirements(decodeToolPerimeter(row.version.perimeter), facts.available)
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
