/**
 * Tools flowing DOWN into a space's sub-spaces (docs/sub-spaces.md).
 *
 * A Tool note `tools/<name>/index.md` in a house carrying `share: all` or
 * `share: [room, …]` is INSTALLED in those rooms: a real `AppToolInstall` row
 * in each, stamped `sharedFromSpaceId`, pointing at the version the house
 * itself runs (or, when the house never installed its own Tool, the newest
 * version it approved). A real row rather than a computed one on purpose —
 * the rail, `/t/<slug>`, the frame token, the bridge and MCP all key on
 * install rows by space, so the room runs the Tool exactly as any install:
 * the code is the published snapshot, the data context is the ROOM, and the
 * bridge holds every call to the room member's own grants.
 *
 * The rows are a projection of the note's `share:`. `syncSharedToolInstalls`
 * re-derives them from scratch — idempotent, so the write hook, an upgrade in
 * the house, a new room and a repair all call the same thing — and never
 * touches an install a room made for itself: a room that installed the Tool
 * on its own keeps that row, whatever the house shares.
 *
 * The decision is pure (`sharedInstallPlan`); everything else is rows.
 */
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'
import { parentShare } from '@/lib/notes/federation'
import { connectorNoteRows } from '@/lib/connectors/locate'
import { connectorNameOfPath, isConnectorNoteAt } from '@/lib/notes/shared/configKinds'
import { reachesRoom, shareTargets } from '@/lib/spaces/subspaces'
import { parentOfSubspace } from '@/lib/spaces/subspaceAccess'
import { readSpaceConfig, updateSpaceConfig } from '@/lib/spaces/spaceConfig'
import { mergeFeatureConfig, toolRailKey } from '@/lib/featureAccess'
import { ADMIN_ALIAS_ID, DEFAULT_NODE_TYPES, type NodeTypeConfig } from '@/lib/types/context'
import { defaultBindings, type BindingValues } from '@visvine/tool-protocol/bindings'
import type { ToolManifestFacts } from '@visvine/tool-protocol/manifest'
import { manifestOf, TOOL_NAME_RE, toolIndexPath, toolNameOfFolder } from './config'
import { toolFolderIn, toolFolders } from './location'
import { decodeToolConfig, toolKey } from './registry'
import { boundRequirements, type SpaceAvailability } from './requirements'
import { featureConfigWithoutRail, orderWithRail, uniqueSlug } from './installs'
import { bindableSpace } from './bindable'

const SHARED_OWNER_KEY = 'shared'

export interface SharePlan {
  /** Rooms that need a shared install created. */
  create: string[]
  /** Rooms whose shared install should move to the house's current version. */
  update: string[]
  /** Rooms whose shared install should go: no longer named, or nothing to run. */
  remove: string[]
}

/**
 * What the rows should become, from what the note says and what is there.
 * A room's OWN install (no `sharedFrom`) is never in any list: the house's
 * share neither replaces nor removes what the room chose for itself. Without
 * a version to run, sharing installs nothing and takes back what it put.
 */
export function sharedInstallPlan(input: {
  houseId: string
  targets: 'all' | string[] | 'none'
  rooms: readonly string[]
  versionId: string | null
  existing: ReadonlyArray<{ spaceId: string; sharedFromSpaceId: string | null; versionId: string }>
}): SharePlan {
  const wanted = new Set(input.versionId ? input.rooms.filter((r) => reachesRoom(input.targets, r)) : [])
  const byRoom = new Map(input.existing.map((row) => [row.spaceId, row]))
  const plan: SharePlan = { create: [], update: [], remove: [] }
  for (const room of wanted) {
    const row = byRoom.get(room)
    if (!row) plan.create.push(room)
    else if (row.sharedFromSpaceId === input.houseId && row.versionId !== input.versionId) plan.update.push(room)
  }
  for (const row of input.existing) {
    if (row.sharedFromSpaceId === input.houseId && !wanted.has(row.spaceId)) plan.remove.push(row.spaceId)
  }
  return plan
}

/**
 * A room's bindings for a shared Tool: what a room admin already bound, else
 * the house's suggestion when the room has that thing too. The rest stay
 * unbound, and the Tool runs degraded in the room until a room admin binds it.
 */
async function roomBindings(room: string, manifest: ToolManifestFacts, current?: unknown): Promise<BindingValues> {
  if (Object.keys(manifest.bindings).length === 0) return {}
  const stored = current && typeof current === 'object' && !Array.isArray(current) ? (current as Record<string, unknown>) : {}
  const values = Object.fromEntries(Object.entries(stored).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  return defaultBindings(manifest, await bindableSpace(room), values)
}

/**
 * What a room has, read without a principal — the same three name spaces an
 * install's requirements are checked against (lib/tools/installs.ts#spaceFacts),
 * but grant-free, because a share is the house's act and no member of the
 * room is standing here to read under. The house's shared connectors count:
 * they are what the room's runs resolve.
 */
async function roomAvailability(roomId: string): Promise<SpaceAvailability> {
  const context = { spaceId: roomId, ownerKey: SHARED_OWNER_KEY }
  const [connectorRows, agentRows, config, shared] = await Promise.all([
    connectorNoteRows(context),
    prisma.agentState.findMany({ where: { spaceId: roomId }, select: { name: true } }),
    readSpaceConfig(roomId),
    parentShare(context),
  ])
  const connectors = new Set<string>()
  for (const row of connectorRows) connectors.add(row.name)
  for (const note of shared?.notes ?? []) {
    const name = connectorNameOfPath(note.path)
    if (name && isConnectorNoteAt(note.path, note.content)) connectors.add(name)
  }
  const stored = (config?.nodeTypes ?? []) as NodeTypeConfig[]
  const types = new Set<string>()
  for (const type of [...stored, ...DEFAULT_NODE_TYPES]) {
    if (typeof type?.name === 'string' && type.name.trim()) types.add(type.name.trim().toLowerCase())
  }
  return { connectors: [...connectors], types: [...types], agents: agentRows.map((a) => a.name) }
}

/** The version a house's shared Tool runs: its own install's, else the newest it approved. */
async function houseVersion(houseId: string, name: string): Promise<{
  versionId: string
  config: unknown
  perimeter: unknown
  installedBy: string | null
} | null> {
  const key = toolKey(houseId, name)
  const own = await prisma.appToolInstall.findUnique({
    where: { app_tool_install_identity: { spaceId: houseId, key } },
    select: { versionId: true, installedBy: true, version: { select: { config: true, perimeter: true, revokedAt: true } } },
  })
  // A withdrawn version is never handed down: the rooms fall back to the
  // newest one still standing, exactly as if the house had never pinned it.
  if (own && !own.version.revokedAt) {
    return { versionId: own.versionId, config: own.version.config, perimeter: own.version.perimeter, installedBy: own.installedBy }
  }
  const approved = await prisma.appToolVersion.findFirst({
    where: { key, status: 'approved', revokedAt: null },
    orderBy: { version: 'desc' },
    select: { id: true, config: true, perimeter: true },
  })
  return approved ? { versionId: approved.id, config: approved.config, perimeter: approved.perimeter, installedBy: null } : null
}

/** Someone to stamp `installedBy` with when the house never installed its own Tool: a holder of its Admin alias. */
async function houseAdminId(houseId: string): Promise<string | null> {
  const row = await prisma.userAlias.findFirst({ where: { spaceId: houseId, aliasId: ADMIN_ALIAS_ID }, select: { userId: true } })
  return row?.userId ?? null
}

/**
 * Make the rooms' install rows match the note's `share:` for one Tool of the
 * house. Safe to call at any time; a no-op when nothing changed.
 */
export async function syncSharedToolInstalls(houseId: string, name: string): Promise<SharePlan> {
  const empty: SharePlan = { create: [], update: [], remove: [] }
  if (!TOOL_NAME_RE.test(name)) return empty
  const folder = await toolFolderIn(houseId, name)
  const [note, rooms] = await Promise.all([
    prisma.contextNote.findFirst({
      where: { spaceId: houseId, ownerKey: SHARED_OWNER_KEY, path: toolIndexPath(name, folder), deletedAt: null },
      select: { content: true },
    }),
    prisma.space.findMany({ where: { parentId: houseId }, select: { id: true } }),
  ])
  const targets = note ? shareTargets(parseFrontmatter(note.content)) : 'none'
  const key = toolKey(houseId, name)
  const roomIds = rooms.map((r) => r.id)
  const version = targets === 'none' ? null : await houseVersion(houseId, name)
  const existing = roomIds.length
    ? await prisma.appToolInstall.findMany({
        where: { key, spaceId: { in: roomIds } },
        select: { spaceId: true, sharedFromSpaceId: true, versionId: true, bindings: true },
      })
    : []
  const plan = sharedInstallPlan({ houseId, targets, rooms: roomIds, versionId: version?.versionId ?? null, existing })
  if (plan.create.length + plan.update.length + plan.remove.length === 0) return plan

  const config = version ? decodeToolConfig(version.config, name) : null
  const manifest = config ? manifestOf(config) : null
  const installedBy = version?.installedBy ?? (plan.create.length ? await houseAdminId(houseId) : null)

  for (const room of plan.create) {
    if (!version || !config || !manifest || !installedBy) break
    const bindings = await roomBindings(room, manifest)
    const requirements = boundRequirements(manifest, bindings, await roomAvailability(room))
    try {
      await updateSpaceConfig(room, async (stored, tx) => {
        const siblings = await tx.appToolInstall.findMany({ where: { spaceId: room }, select: { key: true, slug: true } })
        if (siblings.some((row) => row.key === key)) return {}
        const slug = uniqueSlug(name, new Set(siblings.map((row) => row.slug)))
        await tx.appToolInstall.create({
          data: {
            spaceId: room,
            versionId: version.versionId,
            key,
            slug,
            installedBy,
            sharedFromSpaceId: houseId,
            requirements: requirements as unknown as object,
            bindings: bindings as unknown as object,
            // No page ownership: a shared Tool never takes a type's page off a
            // Tool the room chose for itself. Its tabs and rail row still show.
            typeClaims: {},
          },
        })
        if (!config.surfaces.rail) return {}
        const railKey = toolRailKey(slug)
        return {
          featureConfig: mergeFeatureConfig(stored.featureConfig, {
            order: orderWithRail(stored.featureConfig, railKey),
            enabled: { [railKey]: true },
          }),
        }
      })
    } catch (err) {
      logger.error('tools.share.install_failed', { err, houseId, name, room })
    }
  }

  for (const room of plan.update) {
    if (!version || !manifest) break
    try {
      const current = existing.find((row) => row.spaceId === room)?.bindings
      const bindings = await roomBindings(room, manifest, current)
      const requirements = boundRequirements(manifest, bindings, await roomAvailability(room))
      await prisma.appToolInstall.updateMany({
        where: { spaceId: room, key, sharedFromSpaceId: houseId },
        data: {
          versionId: version.versionId,
          pendingVersionId: null,
          requirements: requirements as unknown as object,
          bindings: bindings as unknown as object,
        },
      })
    } catch (err) {
      logger.error('tools.share.update_failed', { err, houseId, name, room })
    }
  }

  for (const room of plan.remove) {
    try {
      await updateSpaceConfig(room, async (stored, tx) => {
        const row = await tx.appToolInstall.findFirst({
          where: { spaceId: room, key, sharedFromSpaceId: houseId },
          select: { id: true, slug: true },
        })
        if (!row) return {}
        await tx.appToolInstall.deleteMany({ where: { id: row.id } })
        return { featureConfig: featureConfigWithoutRail(stored.featureConfig, toolRailKey(row.slug)) }
      })
    } catch (err) {
      logger.error('tools.share.remove_failed', { err, houseId, name, room })
    }
  }
  return plan
}

/** Every Tool the house shares, by name — the ones whose index says so. */
async function sharedToolNames(houseId: string): Promise<string[]> {
  // Wherever the house filed them (lib/tools/location.ts).
  const folders = await toolFolders(houseId)
  const rows = await prisma.contextNote.findMany({
    where: { spaceId: houseId, ownerKey: SHARED_OWNER_KEY, deletedAt: null, path: { in: [...folders.values()].map((f) => `${f}/index.md`) } },
    select: { path: true, content: true },
  })
  const out: string[] = []
  for (const row of rows) {
    const name = toolNameOfFolder(row.path.slice(0, -'/index.md'.length))
    if (!TOOL_NAME_RE.test(name)) continue
    if (shareTargets(parseFrontmatter(row.content)) !== 'none') out.push(name)
  }
  return out
}

/**
 * A room that has just appeared under a house gets what the house already
 * shares with every room (`share: all`), and anything naming it by id.
 */
export async function syncSharedToolsIntoRoom(roomId: string): Promise<void> {
  const parent = await parentOfSubspace(roomId)
  if (!parent) return
  for (const name of await sharedToolNames(parent.id)) {
    await syncSharedToolInstalls(parent.id, name)
  }
}

/** Never throws — for the write hooks, which must not fail a note save. */
export async function syncSharedToolInstallsQuietly(houseId: string, name: string): Promise<void> {
  try {
    await syncSharedToolInstalls(houseId, name)
  } catch (err) {
    logger.error('tools.share.sync_failed', { err, houseId, name })
  }
}
