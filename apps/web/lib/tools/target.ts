/**
 * Which Tool a bridge call is for, and what it is allowed to be.
 *
 * Every call to `POST /api/tools/bridge` names a target — an INSTALL (a pinned
 * marketplace version running in a space) or a PREVIEW (an author's working copy
 * in their own space). Resolving it is where the three questions that cannot be
 * asked later are settled:
 *
 *   1. Is the viewer a member of the space this Tool runs in? Nothing here
 *      widens `resolveContext`; it is the same membership gate the web routes
 *      and the MCP layer use, so a Tool cannot be a way into a space.
 *   2. Which perimeter applies? For an install, the one on the pinned
 *      AppToolVersion — NEVER the working copy. The author editing
 *      `tools/<name>/index.md` in the source space must not be able to widen
 *      what an installed copy may touch in someone else's space; that is what
 *      the publish/review step is for. Preview reads the working copy, which is
 *      the point of a preview.
 *   3. Is it switched on? A disabled install is dead, not merely hidden.
 *
 * The result carries the viewer's own ContextPrincipal. The perimeter only ever
 * narrows what that principal could already read — contextService does the grant
 * checks and never learns a Tool was involved.
 *
 * Nothing throws for a policy decision: the answer is a ResolvedTarget or a
 * BridgeError the route can hand straight back.
 */
import prisma from '@/lib/prisma'
import { featureAccessForbidden } from '@/lib/auth'
import type { SessionPayload } from '@/lib/session'
import { resolveContext, principalOf, type ResolvedContext } from '@/lib/notes/resolve'
import { readVisible } from '@/lib/notes/contextService'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'
import { SHARED_OWNER_KEY, type Context } from '@/lib/notes/store'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import type { NoteFrontmatter } from '@/lib/notes/shared/types'
import { EMPTY_PERIMETER, parseToolPerimeter, type ToolPerimeter } from './perimeter'
import {
  parseToolBandActions,
  parseToolConfig,
  parseToolNav,
  parseToolPreviewUrl,
  parseToolTags,
  toolIndexPath,
  TOOL_NAME_RE,
  type ToolConfig,
} from './config'
import { toolFolderIn } from './location'
import type { BridgeError, BridgeTarget, ToolDegraded, ToolInstallInfo, ToolSubject } from './protocol'
import { toolRailKey } from '@/lib/featureAccess'
import { principalForUser } from '@/lib/agents/principal'
import { listingHoldFor, runDenial, type ListingHold } from './verdicts'
import { draftAuthorship, nobodyPrincipal, type DraftAuthorship } from './draftAuthors'
import { toolRunDenial, type ToolClient } from './clientClass'
import { composeToolIndex } from './indexFacts'
import { manifestOf } from './config'
import { parseManifestFacts, sdkMajorOf, settingValue, type ToolManifestFacts } from '@visvine/tool-protocol/manifest'
import { resolveReach, sourceBindings, type ToolReach } from '@visvine/tool-protocol/bindings'
import { readToolFacts } from './toolFacts'
import { unboundLabels } from './requirements'
import { honeypotBindings } from './review/shared/canaries'
import { isStaged } from './shared/listing'

/** The stored shape `resolveBridgeTarget` needs off an install row. */
interface InstallRow {
  id: string
  versionId?: string
  spaceId: string
  slug: string
  key: string
  enabled: boolean
  requirements: unknown
  sharedFromSpaceId?: string | null
  listingId?: string | null
  bindings?: unknown
  settings?: unknown
  version: {
    name: string
    title: string
    config: unknown
    perimeter: unknown
    dataBundle: string
    sourceSpaceId?: string
    revokedAt?: Date | null
    revokeReason?: string | null
  }
}

/** The stored shape `resolveBridgeTarget` needs off a preview's build row. */
interface BuildRow {
  ok: boolean
  dataBundle: string | null
}

/**
 * Everything `resolveBridgeTarget` touches that isn't pure, injectable as one
 * object for the same reason `BridgeDeps` exists on the bridge itself: a test
 * can drive the `tools` feature-key gate (and every other refusal) without a
 * database, and can prove it runs BEFORE the perimeter/config work below it.
 */
export interface TargetDeps {
  findInstall: (installId: string) => Promise<InstallRow | null>
  findBuild: (spaceId: string, name: string) => Promise<BuildRow | null>
  resolveContext: typeof resolveContext
  principalOf: typeof principalOf
  readVisible: typeof readVisible
  featureAccessForbidden: typeof featureAccessForbidden
  /** Where the Tool's folder is — `tools/<name>` unless filed elsewhere. Absent: `tools/<name>`. */
  toolFolder?: (spaceId: string, name: string) => Promise<string>
  /** Visvine's hold over a listing. Absent: never held. */
  listingHold?: (ref: { listingId?: string | null; key: string }) => Promise<ListingHold | null>
  /** Who wrote a draft since its last approval. Absent: nobody but the viewer. */
  draftAuthorship?: (spaceId: string, name: string, folder: string) => Promise<DraftAuthorship>
  /** An author's principal in the space, or null when they are gone. */
  principalForUser?: (spaceId: string, userId: string) => Promise<ContextPrincipal | null>
  /** A working copy's facts row (toolFacts.ts). Absent: the index note alone. */
  readFacts?: (spaceId: string, name: string) => Promise<Record<string, unknown> | null>
  /** A dynamic run and the version it runs (lib/tools/review). Absent: no review resolves. */
  findReviewRun?: (runId: string) => Promise<ReviewRunRow | null>
}

/** The stored shape a review target needs off its run row. */
interface ReviewRunRow {
  id: string
  status: string
  honeypotSpaceId: string | null
  runnerUserId: string | null
  versionId: string
  version: { name: string; title: string; key: string; config: unknown; perimeter: unknown; dataBundle: string }
}

const REAL_DEPS: TargetDeps = {
  findInstall: (installId) =>
    prisma.appToolInstall.findUnique({ where: { id: installId }, include: { version: true } }),
  findBuild: (spaceId, name) =>
    prisma.appToolBuild.findUnique({
      where: { app_tool_build_identity: { spaceId, name } },
      select: { ok: true, dataBundle: true },
    }),
  resolveContext,
  principalOf,
  readVisible,
  featureAccessForbidden,
  toolFolder: toolFolderIn,
  listingHold: listingHoldFor,
  draftAuthorship,
  principalForUser,
  readFacts: readToolFacts,
  findReviewRun: (runId) =>
    prisma.appToolReviewRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        status: true,
        honeypotSpaceId: true,
        runnerUserId: true,
        versionId: true,
        version: { select: { name: true, title: true, key: true, config: true, perimeter: true, dataBundle: true } },
      },
    }),
}

/**
 * Everything a handler needs about the Tool it is acting for, resolved once per
 * request. Deliberately flat and already-authorised: a handler reads this and
 * never goes back to the database to ask who is calling.
 */
export interface ResolvedTarget {
  spaceId: string
  /** The VIEWER's principal. Never the Tool's, never the author's. */
  principal: ContextPrincipal
  /**
   * For a preview: everyone else who wrote the draft since its last approved
   * version. The bridge allows a read or write only if the viewer AND each of
   * them could make it — an unreviewed draft never runs with more reach than
   * its authors have. Empty (or absent) for an install, whose code was reviewed.
   */
  coPrincipals?: ContextPrincipal[]
  /** The space's shared context — Tools never see anyone's personal context. */
  context: Context
  /**
   * The declared reach, BOUND: the version's for an install (its `$slots`
   * filled with this space's folders, types, connectors, agents), the note's
   * for a preview (bound to its own suggestions). What every gate reads.
   */
  perimeter: ToolPerimeter
  /** Every family of reach, bound — the v1 lists above plus records, resources, actions, ai, ui. */
  reach?: ToolReach
  /** The install's settings (manifest 2), defaults filled; {} for a v1 Tool. */
  settings?: Record<string, unknown>
  /**
   * Installed from outside this space's family — a listed Tool another space
   * wrote. Such a Tool calls a connector's named actions only, never code.
   */
  foreign?: boolean
  /**
   * Set under Visvine's dynamic run: every call is recorded against the run,
   * and a door out of the space is recorded and never opened (bridge.ts).
   */
  review?: { runId: string }
  /** The install's listing is still staged: its per-viewer bridge rate is halved. */
  staged?: boolean
  /** Who published it, for a Tool from outside the space — what its first-use notice names. */
  publisher?: string | null
  config: ToolConfig
  /** Compiled `data.js`, or '' when the Tool has none (or has not compiled). */
  dataBundle: string
  /** Null for a preview — a working copy has no install to key state against. */
  installId: string | null
  /** The version an install runs; null for a preview. */
  versionId?: string | null
  /** What the space is missing for this Tool to run whole; null when nothing. */
  degraded: ToolDegraded | null
  /** What the Tool is told it is (the `install` global in `data.js`). */
  install: ToolInstallInfo
  /** Is the viewer an admin of this space? Never the Tool's or the author's. */
  isAdmin: boolean
  /**
   * What the Tool is being shown about.
   *
   * Always null today, and honestly so: the REST envelope (BridgeRequest) names
   * a target and nothing else, precisely so a frame cannot ask about a subject
   * it was not given. The frame learns its subject from the host's `visvine:init`
   * / `visvine:subject` messages, which the host knows because it rendered the
   * page. The field exists so `subject.get` and the `data.js` global have one
   * source, and so growing the envelope later changes one line here.
   */
  subject: ToolSubject | null
}

function fail(code: BridgeError['code'], message: string): BridgeError {
  return { code, message }
}

/** A route-shaped error Response → the bridge error that says the same thing. */
async function fromResponse(res: Response): Promise<BridgeError> {
  let message = 'This tool is not available to you.'
  try {
    const body = (await res.clone().json()) as { error?: unknown }
    if (typeof body.error === 'string') message = body.error
  } catch {
    /* not JSON — keep the generic sentence */
  }
  if (res.status === 404) return fail('not_found', message)
  if (res.status === 403 || res.status === 401) return fail('forbidden', message)
  return fail('invalid', message)
}

/**
 * A stored ToolConfig JSON → a ToolConfig, defensively.
 *
 * The value was written by publish, which validated it with parseToolConfig, so
 * this is not a second gate — it is the reader that keeps a hand-edited or
 * schema-drifted row from crashing a render. Anything unreadable falls back to
 * the safe reading (no surfaces, no reach) rather than to a throw, because the
 * perimeter is loaded from its own column and is what actually gates.
 */
function configOfJson(raw: unknown, name: string, perimeter: ToolPerimeter): ToolConfig {
  const record = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
  const surfaces = (record.surfaces ?? {}) as Record<string, unknown>
  const rail = surfaces.rail
  return {
    name: typeof record.name === 'string' && record.name ? record.name : name,
    title: typeof record.title === 'string' && record.title ? record.title : name,
    description: typeof record.description === 'string' ? record.description : '',
    version: typeof record.version === 'number' && Number.isInteger(record.version) ? record.version : 0,
    surfaces: {
      rail:
        rail && typeof rail === 'object' && !Array.isArray(rail)
          ? {
              label: String((rail as Record<string, unknown>).label ?? name),
              icon: String((rail as Record<string, unknown>).icon ?? 'grid'),
            }
          : null,
      types: Array.isArray(surfaces.types)
        ? surfaces.types.flatMap((entry) => {
            if (!entry || typeof entry !== 'object') return []
            const claim = entry as Record<string, unknown>
            if (typeof claim.type !== 'string') return []
            return [{ type: claim.type, mode: claim.mode === 'page' ? ('page' as const) : ('tab' as const) }]
          })
        : [],
      nav: ((n) => (n.ok ? n.nav : null))(parseToolNav(surfaces.nav)),
      actions: ((a) => (a.ok ? a.actions : []))(parseToolBandActions(surfaces.actions)),
    },
    perimeter,
    ...(((m) => (m && m.ok ? { manifest: m.value } : {}))(
      record.manifest && typeof record.manifest === 'object' && !Array.isArray(record.manifest)
        ? parseManifestFacts(record.manifest as Record<string, unknown>)
        : null,
    )),
    // Marketplace metadata; a hostile value falls back to none, like the rest.
    tags: ((t) => (t.ok ? t.tags : []))(parseToolTags(record.tags)),
    previewUrl: ((p) => (p.ok ? p.previewUrl : null))(parseToolPreviewUrl(record.previewUrl)),
  }
}

function objectOf(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
}

/** A stored binding map, keeping only string values. */
function stringMap(raw: unknown): Record<string, string> {
  return Object.fromEntries(Object.entries(objectOf(raw)).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

/** The v1 lists the gates read, from a bound reach. */
function perimeterOfReach(reach: ToolReach): ToolPerimeter {
  return { read: reach.read, write: reach.write, types: reach.types, connectors: reach.connectors, agents: reach.agents }
}

/** Each declared setting's value here, or its default; a stored value its spec refuses falls back to the default. */
function settingsWithDefaults(facts: ToolManifestFacts, stored: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, spec] of Object.entries(facts.settings)) {
    const value = stored[key]
    if (value !== undefined && settingValue(spec, value).ok) out[key] = value
    else if (spec.default !== undefined) out[key] = spec.default
  }
  return out
}

/** Unbound slots join what the space is missing: the Tool runs degraded, behind the same banner. */
function withUnbound(degraded: ToolDegraded | null, unbound: readonly string[], facts: ToolManifestFacts): ToolDegraded | null {
  const labels = unboundLabels(facts, unbound)
  if (labels.length === 0) return degraded
  return { missing: { ...(degraded?.missing ?? { connectors: [], types: [], agents: [] }), bindings: labels } }
}

/** The install's requirements snapshot → the degraded banner, or null. */
function degradedOfRequirements(raw: unknown): ToolDegraded | null {
  const record = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
  const list = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  const missing = {
    connectors: list(record.connectors),
    types: list(record.types),
    agents: list(record.agents),
  }
  const empty = missing.connectors.length === 0 && missing.types.length === 0 && missing.agents.length === 0
  return empty ? null : { missing }
}

/**
 * The key a Tool's server-side state and its `data.call` concurrency are counted
 * under. An install is its row; a preview is scoped to the space AND the name,
 * so two previews in one space cannot read each other's state.
 */
export function targetKey(t: ResolvedTarget): string {
  if (t.review) return `review:${t.review.runId}`
  return t.installId ?? `preview:${t.spaceId}/${t.config.name}`
}

/**
 * Resolve + authorise the Tool a bridge call names. The one door: every handler
 * takes what this returns and asks nothing further about identity.
 *
 * `client` is the kind of client asking (lib/tools/clientClass.ts): a phone app
 * never runs a Tool, so it is refused before anything is read. Every HTTP door
 * passes it; a caller with no client (a script, a test) is not a phone.
 */
export async function resolveBridgeTarget(
  session: SessionPayload,
  target: unknown,
  deps: TargetDeps = REAL_DEPS,
  client: ToolClient = 'app',
): Promise<ResolvedTarget | BridgeError> {
  const phone = toolRunDenial(client)
  if (phone) return phone
  if (!target || typeof target !== 'object') return fail('invalid', 'No tool named in this request.')
  const kind = (target as { kind?: unknown }).kind
  if (kind === 'install') return resolveInstall(session, target as Extract<BridgeTarget, { kind: 'install' }>, deps)
  if (kind === 'preview') return resolvePreview(session, target as Extract<BridgeTarget, { kind: 'preview' }>, deps)
  if (kind === 'review') return resolveReview(session, target as Extract<BridgeTarget, { kind: 'review' }>, deps)
  return fail('invalid', 'Unknown tool target.')
}

/**
 * The refusal every branch shares once membership is settled. There is no
 * `tools` key — a Tool is a node of the DIRECTORY (lib/featureAccess.ts), so
 * that is the gate, and a space that holds its directory to admins holds its
 * Tools to admins too. Checked before any perimeter/config work, so such a
 * space never sees the shape of a Tool it may not run, install-scoped
 * `enabled` included.
 */
async function forbiddenForTools(resolved: ResolvedContext, deps: TargetDeps): Promise<BridgeError | null> {
  if (await deps.featureAccessForbidden(resolved.actor.id, resolved.spaceId, 'directory', resolved.actor.email)) {
    return fail('forbidden', 'Tools are not available to you in this space.')
  }
  return null
}

async function resolveInstall(
  session: SessionPayload,
  target: { installId?: unknown },
  deps: TargetDeps,
): Promise<ResolvedTarget | BridgeError> {
  if (typeof target.installId !== 'string' || !target.installId) {
    return fail('invalid', 'No install named in this request.')
  }
  const install = await deps.findInstall(target.installId)
  if (!install) return fail('not_found', 'This tool is not installed here.')

  const resolved = await deps.resolveContext(session, install.spaceId)
  if (resolved instanceof Response) return fromResponse(resolved)
  const forbidden = await forbiddenForTools(resolved, deps)
  if (forbidden) return forbidden
  if (!install.enabled) {
    return fail('forbidden', 'This tool is turned off in this space — an admin can switch it back on.')
  }
  // An admin who locked this Tool's rail row locked the Tool: its page, its
  // tabs on type pages, and every call its frame makes.
  if (await deps.featureAccessForbidden(resolved.actor.id, resolved.spaceId, toolRailKey(install.slug), resolved.actor.email)) {
    return fail('forbidden', 'This tool is for admins in this space.')
  }
  // Pulled back after approval: withdrawn by its space, or its listing held by
  // Visvine. Read on every call, so a pulled version stops at its next one.
  const sourceSpaceId = install.version.sourceSpaceId ?? install.spaceId
  const listing =
    sourceSpaceId !== install.spaceId && deps.listingHold
      ? await deps.listingHold({ listingId: install.listingId ?? null, key: install.key })
      : null
  const denial = runDenial({
    version: { revokedAt: install.version.revokedAt ?? null, revokeReason: install.version.revokeReason ?? null },
    listing,
    sourceSpaceId,
    installSpaceId: install.spaceId,
    sharedFromSpaceId: install.sharedFromSpaceId ?? null,
  })
  if (denial) return denial

  // The VERSION, not the working copy: an install runs the code and the reach a
  // reviewer approved, whatever the source space's notes say today — bound to
  // what this install's admin bound its slots to.
  const parsed = parseToolPerimeter(install.version.perimeter)
  const config = configOfJson(install.version.config, install.version.name, parsed.ok ? parsed.perimeter : EMPTY_PERIMETER)
  const facts = manifestOf(config)
  const bound = resolveReach(facts, stringMap(install.bindings))
  const perimeter = perimeterOfReach(bound.reach)
  const settings = settingsWithDefaults(facts, objectOf(install.settings))

  return {
    spaceId: install.spaceId,
    principal: await deps.principalOf(resolved),
    context: { spaceId: install.spaceId, ownerKey: SHARED_OWNER_KEY },
    perimeter,
    reach: bound.reach,
    settings,
    foreign: sourceSpaceId !== install.spaceId && !install.sharedFromSpaceId,
    staged: !install.sharedFromSpaceId && isStaged(listing ? { stagedUntil: listing.stagedUntil ?? null } : null, new Date()),
    publisher: listing?.publisher ?? null,
    config,
    dataBundle: install.version.dataBundle,
    installId: install.id,
    versionId: install.versionId ?? null,
    degraded: withUnbound(degradedOfRequirements(install.requirements), bound.unbound, facts),
    install: {
      slug: install.slug,
      title: config.title,
      key: install.key,
      settings,
      bindings: stringMap(install.bindings),
      sdk: sdkMajorOf(facts.sdk),
    },
    isAdmin: resolved.isAdmin,
    subject: null,
  }
}

async function resolvePreview(
  session: SessionPayload,
  target: { spaceId?: unknown; name?: unknown },
  deps: TargetDeps,
): Promise<ResolvedTarget | BridgeError> {
  if (typeof target.spaceId !== 'string' || !target.spaceId) {
    return fail('invalid', 'No space named in this request.')
  }
  if (typeof target.name !== 'string' || !TOOL_NAME_RE.test(target.name)) {
    return fail('invalid', 'Not a tool name.')
  }
  const name = target.name

  const resolved = await deps.resolveContext(session, target.spaceId)
  if (resolved instanceof Response) return fromResponse(resolved)
  const forbidden = await forbiddenForTools(resolved, deps)
  if (forbidden) return forbidden
  const principal = await deps.principalOf(resolved)
  const context: Context = { spaceId: target.spaceId, ownerKey: SHARED_OWNER_KEY }

  // Reading the index note IS the permission check: readVisible applies the
  // folder lens, and returns null identically for absent and invisible — so a
  // preview cannot be used to probe which Tools exist in a folder the viewer
  // cannot see.
  const folder = deps.toolFolder ? await deps.toolFolder(target.spaceId, name) : undefined
  const note = await deps.readVisible(principal, context, toolIndexPath(name, folder))
  if (note === null) return fail('not_found', `No tool named "${name}" here.`)
  // The working copy's facts row, rendered into the note the way the build reads it.
  const source = composeToolIndex(note, deps.readFacts ? await deps.readFacts(target.spaceId, name) : null)

  const parsedConfig = parseToolConfig(parseFrontmatter(source) as NoteFrontmatter, name)
  if (!parsedConfig.ok) return fail('invalid', parsedConfig.error)

  // The working copy's own build row. Absent or failed means there is no data.js
  // to run — every other method still works, so a preview of a half-written Tool
  // renders instead of 404ing.
  const build = await deps.findBuild(target.spaceId, name)

  // Everyone else who wrote this draft since its last approval: their reach
  // bounds it, whoever opens it (lib/tools/draftAuthors.ts).
  const coPrincipals: ContextPrincipal[] = []
  if (deps.draftAuthorship) {
    const draft = await deps.draftAuthorship(target.spaceId, name, folder ?? `tools/${name}`)
    for (const author of draft.authors) {
      if (author.userId === session.userId) continue
      const theirs = deps.principalForUser ? await deps.principalForUser(target.spaceId, author.userId) : null
      coPrincipals.push(theirs ?? nobodyPrincipal(target.spaceId, author))
    }
  }

  // A working copy runs in the space that wrote it, bound to its own suggestions.
  const facts = manifestOf(parsedConfig.config)
  const bindings = sourceBindings(facts)
  const bound = resolveReach(facts, bindings)
  const settings = settingsWithDefaults(facts, {})
  return {
    spaceId: target.spaceId,
    principal,
    coPrincipals,
    context,
    perimeter: perimeterOfReach(bound.reach),
    reach: bound.reach,
    settings,
    config: parsedConfig.config,
    dataBundle: build?.ok ? (build.dataBundle ?? '') : '',
    installId: null,
    // Requirements are an install concept; an author previewing their own work
    // sees the real failures instead of a banner.
    degraded: null,
    install: { preview: true, name, settings, bindings, sdk: sdkMajorOf(facts.sdk) },
    isAdmin: resolved.isAdmin,
    subject: null,
  }
}

/**
 * A version under Visvine's dynamic run (lib/tools/review). Resolves for the
 * review runner alone, in the run's own honeypot, while the run runs — a
 * version waiting on Visvine can be installed nowhere, so this is the one
 * door it runs through. It runs as it would for any space that installed it:
 * from outside, bound to its suggestions, with the settings' defaults.
 */
async function resolveReview(
  session: SessionPayload,
  target: { runId?: unknown },
  deps: TargetDeps,
): Promise<ResolvedTarget | BridgeError> {
  if (typeof target.runId !== 'string' || !target.runId) return fail('invalid', 'No review named in this request.')
  const run = deps.findReviewRun ? await deps.findReviewRun(target.runId) : null
  if (!run || run.status !== 'running' || !run.honeypotSpaceId || run.runnerUserId !== session.userId) {
    return fail('not_found', 'Nothing is running here.')
  }
  const resolved = await deps.resolveContext(session, run.honeypotSpaceId)
  if (resolved instanceof Response) return fromResponse(resolved)
  const parsed = parseToolPerimeter(run.version.perimeter)
  const config = configOfJson(run.version.config, run.version.name, parsed.ok ? parsed.perimeter : EMPTY_PERIMETER)
  const facts = manifestOf(config)
  const bindings = honeypotBindings(facts)
  const bound = resolveReach(facts, bindings)
  const settings = settingsWithDefaults(facts, {})
  return {
    spaceId: run.honeypotSpaceId,
    principal: await deps.principalOf(resolved),
    context: { spaceId: run.honeypotSpaceId, ownerKey: SHARED_OWNER_KEY },
    perimeter: perimeterOfReach(bound.reach),
    reach: bound.reach,
    settings,
    foreign: true,
    review: { runId: run.id },
    config,
    dataBundle: run.version.dataBundle,
    installId: null,
    versionId: run.versionId,
    degraded: null,
    install: { slug: 'review', title: config.title, key: run.version.key, settings, bindings, sdk: sdkMajorOf(facts.sdk) },
    isAdmin: resolved.isAdmin,
    subject: null,
  }
}
