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
import { parseToolConfig, toolIndexPath, TOOL_NAME_RE, type ToolConfig } from './config'
import type { BridgeError, BridgeTarget, ToolDegraded, ToolInstallInfo, ToolSubject } from './protocol'

/** The stored shape `resolveBridgeTarget` needs off an install row. */
interface InstallRow {
  id: string
  spaceId: string
  slug: string
  key: string
  enabled: boolean
  requirements: unknown
  version: {
    name: string
    title: string
    config: unknown
    perimeter: unknown
    dataBundle: string
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
  /** The space's shared context — Tools never see anyone's personal context. */
  context: Context
  /** The declared reach: the version's for an install, the note's for a preview. */
  perimeter: ToolPerimeter
  config: ToolConfig
  /** Compiled `data.js`, or '' when the Tool has none (or has not compiled). */
  dataBundle: string
  /** Null for a preview — a working copy has no install to key state against. */
  installId: string | null
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
    },
    perimeter,
  }
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
  return t.installId ?? `preview:${t.spaceId}/${t.config.name}`
}

/**
 * Resolve + authorise the Tool a bridge call names. The one door: every handler
 * takes what this returns and asks nothing further about identity.
 */
export async function resolveBridgeTarget(
  session: SessionPayload,
  target: unknown,
  deps: TargetDeps = REAL_DEPS,
): Promise<ResolvedTarget | BridgeError> {
  if (!target || typeof target !== 'object') return fail('invalid', 'No tool named in this request.')
  const kind = (target as { kind?: unknown }).kind
  if (kind === 'install') return resolveInstall(session, target as Extract<BridgeTarget, { kind: 'install' }>, deps)
  if (kind === 'preview') return resolvePreview(session, target as Extract<BridgeTarget, { kind: 'preview' }>, deps)
  return fail('invalid', 'Unknown tool target.')
}

/**
 * The refusal every branch shares once membership is settled: `tools` is a
 * real feature key (lib/featureAccess.ts) an admin can switch off for a
 * space, same as `agents` — see lib/tools/bridge.ts#agentsRun. Checked before
 * any perimeter/config work, so a disabled space never sees the shape of a
 * Tool it may not run, install-scoped `enabled` included.
 */
async function forbiddenForTools(resolved: ResolvedContext, deps: TargetDeps): Promise<BridgeError | null> {
  if (await deps.featureAccessForbidden(resolved.actor.id, resolved.spaceId, 'tools', resolved.actor.email)) {
    return fail('forbidden', 'The Tools feature is not available to you in this space.')
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

  // The VERSION, not the working copy: an install runs the code and the reach a
  // reviewer approved, whatever the source space's notes say today.
  const parsed = parseToolPerimeter(install.version.perimeter)
  const perimeter = parsed.ok ? parsed.perimeter : EMPTY_PERIMETER
  const config = configOfJson(install.version.config, install.version.name, perimeter)

  return {
    spaceId: install.spaceId,
    principal: await deps.principalOf(resolved),
    context: { spaceId: install.spaceId, ownerKey: SHARED_OWNER_KEY },
    perimeter,
    config,
    dataBundle: install.version.dataBundle,
    installId: install.id,
    degraded: degradedOfRequirements(install.requirements),
    install: { slug: install.slug, title: config.title, key: install.key },
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
  const source = await deps.readVisible(principal, context, toolIndexPath(name))
  if (source === null) return fail('not_found', `No tool named "${name}" here.`)

  const parsedConfig = parseToolConfig(parseFrontmatter(source) as NoteFrontmatter, name)
  if (!parsedConfig.ok) return fail('invalid', parsedConfig.error)

  // The working copy's own build row. Absent or failed means there is no data.js
  // to run — every other method still works, so a preview of a half-written Tool
  // renders instead of 404ing.
  const build = await deps.findBuild(target.spaceId, name)

  return {
    spaceId: target.spaceId,
    principal,
    context,
    perimeter: parsedConfig.config.perimeter,
    config: parsedConfig.config,
    dataBundle: build?.ok ? (build.dataBundle ?? '') : '',
    installId: null,
    // Requirements are an install concept; an author previewing their own work
    // sees the real failures instead of a banner.
    degraded: null,
    install: { preview: true, name },
    isAdmin: resolved.isAdmin,
    subject: null,
  }
}
