// Context-driven context links: an entity context note (people/<slug>.md or
// companies/<slug>.md, shared context only) that mentions another entity via
// `[[Name]]` owns a real directory Link between the two nodes — relationship
// 'mentioned', origin 'context', originRef = the note's path. Saving a note
// syncs its mention set; removing a mention (or trashing/renaming the note)
// removes the link, unless the counterpart's note still mentions back, in which
// case ownership re-points to the counterpart instead of dropping the edge.
// Manual links are never touched: upsertLink's provenance rules mean a manual
// edge absorbs a context write without demotion, and stale-cleanup only deletes
// rows whose origin is 'context'.
//
// Called best-effort from the note store (lib/notes/store.ts) — a sync failure
// must never fail the save itself.

import { createHash } from 'crypto'
import { revalidateTag } from 'next/cache'
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { upsertLink } from '@/lib/notes/context/links'
import { pairKeyFor } from '@/lib/notes/context/relationships'
import { spaceNodeId, removeEntityNode, syncEntityNode } from '@/lib/notes/context/entityNodes'
import { connectorNameOfPath, isConnectorNoteAt } from './shared/configKinds'
import {
  mergeContextMeta,
  nextContextMeta,
  readLinkContextMeta,
} from '@/lib/notes/context/linkReason'
import { scheduleLinkReasons } from '@/lib/notes/linkReasons'
import { parseFrontmatter, splitFrontmatter } from './shared/markdown'
import { excerptsForTargets } from './shared/references'
import { declaredFolderOnlyEntity, entityNameClashDenial, isIndexPath } from './shared/indexNote'
import {
  adoptedNotePath,
  agentNameOfPath,
  entityKindOf,
  entityKindOfPath,
  entityNotePath,
  entityNotePaths,
  entityOwnerPathOf,
  isAdoptableEntityType,
  isAgentBriefPath,
  linkedNotePaths,
} from './entities'
import { slugify } from '@/lib/eventUtils'
import { Prisma } from '@prisma/client'
import { toolFileKindOfPath, toolNameOfPath } from '@/lib/tools/config'

// Matches store.ts's SHARED_OWNER_KEY — redeclared here (not imported) so the
// store can call into this module without a circular import.
const SHARED_OWNER_KEY = 'shared'

const CONTEXT_RELATIONSHIP = 'mentioned'
export const CONTEXT_ORIGIN = 'context'

interface ContextRef {
  spaceId: string
  ownerKey: string
}

interface EntityMaps {
  idByPath: Map<string, string>
  pathById: Map<string, string>
}

function bustContextCache(): void {
  try {
    revalidateTag('context-data-v2', { expire: 0 })
  } catch {
    /* outside request scope */
  }
}

// Both directions of the node ↔ note-path mapping for a space. Paths are NOT
// reconstructible from ids by string surgery (see entities.ts), so this map —
// entityNotePath over the real nodes — is the only sound bridge.
//
// `idByPath` holds BOTH forms of every entity path (people/x.md and
// people/x/index.md): a link written before the entity's note became a folder
// and one written after both resolve to the node. `pathById` holds the one
// canonical (metadata-aware) path — where the note actually lives.
async function loadEntityMaps(spaceId: string): Promise<EntityMaps> {
  const nodes = await prisma.node.findMany({
    where: { spaceId },
    select: { id: true, type: true, metadata: true },
  })
  const idByPath = new Map<string, string>()
  const pathById = new Map<string, string>()
  for (const node of nodes) {
    // A connector's id slugifies the filename (`my_api` → `connector:my-api`),
    // which is lossy, so its metadata is the only exact path back to the note.
    if (node.type === 'connector' || node.type === 'agent') {
      const path = notePathOfNode(node.metadata)
      if (!path) continue
      idByPath.set(path, node.id)
      pathById.set(node.id, path)
      continue
    }
    const entity = { ...node, metadata: (node.metadata as Record<string, unknown> | null) ?? null }
    const canonical = entityNotePath(entity)
    if (!canonical) continue
    // entityNotePath/entityNotePaths already answer with the adopted note when
    // the node has one, so an adopted entity registers exactly the path it was
    // declared at and none of the namespace paths it never occupied.
    for (const path of entityNotePaths(entity)) idByPath.set(path, node.id)
    pathById.set(node.id, canonical)
  }
  return { idByPath, pathById }
}

/**
 * The node a note at `path` speaks for: an entity note (either form) → its
 * node; a sub-note inside an entity folder (people/x/notes.md) → the folder's
 * node — a sub-note's mentions are the entity's mentions, so they draw the
 * entity's edges. Null for a plain note (no node, so no edges).
 */
function ownerIdOf(path: string, maps: EntityMaps): string | null {
  const direct = maps.idByPath.get(path)
  if (direct) return direct
  const owner = entityOwnerPathOf(path)
  if (owner) return maps.idByPath.get(`${owner}/index.md`) ?? null
  // An adopted entity's folder is wherever it was declared, so there is no
  // shape to match — the nearest ancestor whose index a node claims is the
  // owner. Mirrors resolveEntityOwner, which is the client's half of this.
  const segments = path.split('/')
  for (let depth = segments.length - 1; depth > 0; depth--) {
    const id = maps.idByPath.get(`${segments.slice(0, depth).join('/')}/index.md`)
    if (id) return id
  }
  return null
}

/**
 * The live shared notes that speak for `nodeId` other than `except`: its
 * entity note (either form) plus every sub-note in its folder. Used to keep an
 * edge alive when the note that owned it stops mentioning the counterpart but
 * a sibling still does.
 */
async function siblingNotesOf(spaceId: string, nodeId: string, maps: EntityMaps, except: string) {
  const canonical = maps.pathById.get(nodeId)
  if (!canonical) return []
  const folder = canonical.replace(/\/index\.md$/i, '').replace(/\.md$/i, '')
  const rows = await prisma.contextNote.findMany({
    where: {
      spaceId,
      ownerKey: SHARED_OWNER_KEY,
      deletedAt: null,
      OR: [{ path: canonical }, { path: { startsWith: `${folder}/` } }],
    },
    select: { path: true, content: true },
  })
  return rows.filter((r) => r.path !== except && ownerIdOf(r.path, maps) === nodeId)
}

/**
 * A live note speaking for `speakerId` (other than `except`) that still
 * mentions `targetId` — the note an orphaned edge can be re-pointed to — with
 * the mention path it used, or null.
 */
async function heirFor(
  spaceId: string,
  speakerId: string,
  targetId: string,
  maps: EntityMaps,
  except: string,
): Promise<{ path: string; content: string; target: string } | null> {
  for (const note of await siblingNotesOf(spaceId, speakerId, maps, except)) {
    const target = linkedNotePaths(note.path, note.content).find(
      (m) => maps.idByPath.get(m) === targetId,
    )
    if (target) return { path: note.path, content: note.content, target }
  }
  return null
}

/** The context path a `connector:` node stands for, off its metadata. */
function notePathOfNode(metadata: unknown): string | null {
  const value = (metadata as Record<string, unknown> | null)?.notePath
  return typeof value === 'string' && value ? value : null
}

// Folders whose notes the platform reads as configuration or as another
// space's context. A `type: Person` note under one of them is not an invitation
// to mint a node: connectors/ and models/ are admin-gated perimeters, agents/
// and tools/ are note-first kinds with their own sync, and subspaces/ is a
// sub-space's context grafted in read-only. (The other direction — a
// `type: connector` note in an ordinary folder — is a connector, synced by
// syncConnectorNode from syncNoteNode; see lib/notes/shared/configKinds.ts.)
const UNADOPTABLE_ROOTS = new Set([
  'agents',
  'connectors',
  'models',
  'tools',
  'subspaces',
])

/** How many `-2`, `-3`… suffixes to try before giving up on a free node id. */
const MAX_ID_ATTEMPTS = 5

/** May a note at this path be adopted at all, whatever it declares? */
function adoptablePath(path: string): boolean {
  const root = path.split('/')[0] ?? ''
  if (UNADOPTABLE_ROOTS.has(root)) return false
  // Inside an entity namespace the shape already decides: the entity note is
  // an entity note, and everything else there is one of its sub-notes.
  return entityOwnerPathOf(path) === null && entityKindOfPath(path) === null
}

/** The type a note declares, as an adoptable entity kind, or null. */
function declaredAdoptableKind(content: string): 'person' | 'space' | 'resource' | 'event' | null {
  const declared = parseFrontmatter(content).type
  if (typeof declared !== 'string' || !isAdoptableEntityType(declared)) return null
  return entityKindOf(declared) as 'person' | 'space' | 'resource' | 'event'
}

/** The display name an adopted note goes by: its `title:`, else its filename
 *  (or, for a folder index, the folder's name). */
function adoptedNameOf(path: string, content: string): string {
  const title = parseFrontmatter(content).title
  if (typeof title === 'string' && title.trim()) return title.trim()
  const segments = path.replace(/\.md$/i, '').split('/')
  const last = isIndexPath(path) ? segments[segments.length - 2] : segments[segments.length - 1]
  return (last ?? path).replace(/[-_]+/g, ' ').trim() || path
}

/** The node currently bound to `path` by its `metadata.notePath` pointer. */
async function adoptedNodeAt(spaceId: string, path: string) {
  const rows = await prisma.node.findMany({
    where: { spaceId, metadata: { path: ['notePath'], equals: path } },
    select: { id: true, type: true, name: true, metadata: true },
  })
  return rows.find((row) => adoptedNotePath({ ...row, metadata: row.metadata as Record<string, unknown> | null }) === path) ?? null
}

/** What an adopted note is a note ABOUT, as a key two paths can be matched on:
 *  the kind it declares and the name it goes by. */
function adoptionKey(kind: string, name: string): string {
  return `${kind}:${slugify(name)}`
}

/**
 * Carry adopted nodes across a rename before anything else looks at the paths.
 *
 * A move reaches the sync as remove-then-add, and an adopted node is bound to
 * the path it was declared at — so left alone, moving `Team/Alex.md` would
 * delete Alex and mint a new Alex, losing the links, the tracked fields and
 * every href anyone had to the profile. The same kind under the same name
 * arriving as one of the added paths is that note landing, so the pointer
 * follows it and both halves then read as an ordinary re-save.
 */
async function repointAdoptedNodes(
  spaceId: string,
  removed: string[],
  added: Array<[path: string, content: string]>,
): Promise<void> {
  if (removed.length === 0 || added.length === 0) return
  const landedAt = new Map<string, string>()
  for (const [path, content] of added) {
    if (!adoptablePath(path)) continue
    const kind = declaredAdoptableKind(content)
    if (kind) landedAt.set(adoptionKey(kind, adoptedNameOf(path, content)), path)
  }
  if (landedAt.size === 0) return
  for (const from of removed) {
    const bound = await adoptedNodeAt(spaceId, from)
    if (!bound) continue
    const kind = entityKindOf(bound.type)
    const to = kind ? landedAt.get(adoptionKey(kind, bound.name ?? '')) : undefined
    if (!to || to === from) continue
    await prisma.node.update({
      where: { id: bound.id },
      data: {
        metadata: {
          ...((bound.metadata as Record<string, unknown> | null) ?? {}),
          notePath: to,
        } as Prisma.InputJsonObject,
      },
    })
  }
}

/**
 * Carry connector nodes across a move the same way: a connector's node is
 * bound to its note's path (`metadata.notePath`, the record key), and a move
 * arrives as remove-then-add. The same NAME landing among the added paths as
 * a connector is that note arriving, so the pointer follows it and the
 * remove step then finds nothing at the old path — the node, its links and
 * every href to `/directory/connector:<name>` survive.
 */
async function repointConnectorNodes(
  spaceId: string,
  removed: string[],
  added: Array<[path: string, content: string]>,
): Promise<void> {
  if (removed.length === 0 || added.length === 0) return
  const landedAt = new Map<string, string>()
  for (const [path, content] of added) {
    const name = connectorNameOfPath(path)
    if (name && isConnectorNoteAt(path, content)) landedAt.set(name, path)
  }
  if (landedAt.size === 0) return
  for (const from of removed) {
    const name = connectorNameOfPath(from)
    const to = name ? landedAt.get(name) : undefined
    if (!to || to === from) continue
    const bound = await prisma.node.findFirst({
      where: { spaceId, type: 'connector', metadata: { path: ['notePath'], equals: from } },
      select: { id: true, metadata: true },
    })
    if (!bound) continue
    await prisma.node.update({
      where: { id: bound.id },
      data: {
        metadata: {
          ...((bound.metadata as Record<string, unknown> | null) ?? {}),
          notePath: to,
        } as Prisma.InputJsonObject,
      },
    })
  }
}

/**
 * The node behind a note that DECLARES an entity type from wherever it happens
 * to sit — `Team/Alex Apoifis.md` with `type: Person` is a person, with the
 * same node, profile page and backlinks as one written at
 * people/alex-apoifis/index.md. See "adopted entity notes" in entities.ts for
 * why the pointer rather than the path carries the binding, and
 * ADOPTABLE_ENTITY_KINDS for why only the record kinds qualify.
 *
 * Idempotent. Re-declaring keeps the id (and so the links, the tracked-field
 * values and the saved position); dropping the `type:`, or the note itself,
 * drops the node. Metadata is MERGED, never replaced: the node's tracked-field
 * values are the Directory table's, not this sync's.
 *
 * A note carrying `node:` for a node this space already has binds to it rather
 * than minting a second — that is what carries an adopted folder through a
 * move, since its index keeps the pointer in its frontmatter.
 */
export async function syncAdoptedNode(
  spaceId: string,
  path: string,
  content: string | null,
): Promise<boolean> {
  if (!adoptablePath(path)) return false
  const bound = await adoptedNodeAt(spaceId, path)
  const kind = content === null ? null : declaredAdoptableKind(content)
  if (!kind) {
    // Gone, or no longer claiming a type: the note stops speaking for a node.
    if (!bound) return false
    await prisma.node.delete({ where: { id: bound.id } })
    return true
  }

  const name = adoptedNameOf(path, content as string)
  const fm = parseFrontmatter(content as string)
  const description = typeof fm.description === 'string' ? fm.description.trim() : ''
  const tags = Array.isArray(fm.tags)
    ? fm.tags.filter((t): t is string => typeof t === 'string' && t.trim() !== '')
    : []
  const fields = {
    type: kind,
    name,
    ...(description ? { subtitle: description } : {}),
    tags,
  }

  // The note names its node (an adopted folder's index carries `node:`): bind
  // to that row when this space has it and nothing else holds it.
  const declaredId = typeof fm.node === 'string' && fm.node.trim() ? fm.node.trim() : null
  const claimant =
    bound ??
    (declaredId
      ? await prisma.node.findFirst({
          where: { spaceId, id: declaredId },
          select: { id: true, type: true, metadata: true },
        })
      : null)

  if (claimant) {
    const metadata = {
      ...((claimant.metadata as Record<string, unknown> | null) ?? {}),
      notePath: path,
    }
    await prisma.node.update({
      where: { id: claimant.id },
      data: { ...fields, metadata: metadata as Prisma.InputJsonObject },
    })
    return true
  }

  const baseId = `${kind}:${slugify(name) || slugify(path) || kind}`
  for (let attempt = 1; attempt <= MAX_ID_ATTEMPTS; attempt++) {
    const id = attempt === 1 ? baseId : `${baseId}-${attempt}`
    try {
      await prisma.node.create({
        data: {
          id,
          ...fields,
          metadata: { notePath: path } as Prisma.InputJsonObject,
          spaceId,
        },
        select: { id: true },
      })
      return true
    } catch (err) {
      // Node ids are global, so a taken id is expected — suffix and retry.
      const taken = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
      if (!taken) throw err
    }
  }
  logger.warn('notes.adoptedNode.noFreeId', { spaceId, path, baseId })
  return false
}

/**
 * The node a saved note owns, if any. Only connectors qualify: a connector is
 * the one entity whose note comes first, so this is the one entity namespace
 * the note store owns rather than skips (see entities.ts).
 *
 * Every other note is content in the context, not a node in the graph — an entity
 * note (people/craig.md) is already drawn as that entity, and a plain note has
 * no node of its own, so it draws nothing and owns no edges.
 *
 * `content: null` means the note is gone, so its node goes with it. Returns true
 * when anything changed.
 */
async function syncNoteNode(
  spaceId: string,
  path: string,
  content: string | null,
): Promise<boolean> {
  const kind = entityKindOfPath(path)
  // A Tool's entity note IS an index path (it is folder-only — see
  // entities.ts), so it must be checked BEFORE the generic index-path skip
  // below; every other entity kind's index (a person's, a connector's) is
  // reached elsewhere and has nothing new to sync here.
  if (kind === 'tool') return content === null ? false : ensureToolNode(spaceId, path, content)
  // An agent is folder-only too: its brief IS an index path, so it is answered
  // before the generic index skip, and a write that declares `type: agent` at
  // a fresh agents/<name>/index.md makes the node (ensureAgentNode) the way a
  // Tool's does — the store calls it ahead of the index contract for the same
  // reason (see ensureToolNode).
  if (kind === 'agent') return syncAgentNode(spaceId, path, content)
  // A note OUTSIDE the namespaces that declares an entity type owns a node
  // too — index or not, since an entity's note is its folder's index wherever
  // the folder sits. Checked before the index skip for exactly that reason.
  // A connector is such a declaration as well (lib/notes/shared/configKinds.ts):
  // `teams/growth/hubspot.md` with `type: connector` is the connector, and
  // its node points at that path. Gone, the node bound to the path goes too.
  if (!kind) {
    if (content === null) {
      const connectorGone = await removeEntityNode(spaceId, 'connector', path)
      return (await syncAdoptedNode(spaceId, path, null)) || connectorGone
    }
    if (isConnectorNoteAt(path, content)) return syncConnectorNode(spaceId, path, content)
    return syncAdoptedNode(spaceId, path, content)
  }
  if (isIndexPath(path)) return false
  if (kind === 'connector') return syncConnectorNode(spaceId, path, content)
  if (kind === 'model') return syncModelNode(spaceId, path, content)
  return false
}

/**
 * The `agent:<name>` node behind an `agents/<name>/index.md` write that
 * declares `type: agent`, made when none backs it yet. The counterpart of
 * ensureToolNode, for the same reason: the brief is the folder's index, and
 * store.ts#enforceIndexContract holds an entity index to its node — with no
 * node the contract falls back to the plain folder shape and `type: agent`
 * would be lost on the very first save. Called from the store before the
 * contract is enforced; a no-op (`false`) for any other path, content that
 * doesn't declare the type, a name AGENT_NAME_RE rejects, or a node that
 * already exists. Throws when the id is claimed by another space.
 */
export async function ensureAgentNode(spaceId: string, path: string, content: string): Promise<boolean> {
  if (!isAgentBriefPath(path)) return false
  const name = agentNameOfPath(path)
  if (!name || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) return false
  const declared = declaredFolderOnlyEntity(parseFrontmatter(content), 'agent', name)
  if (!declared) return false

  const nodeId = `agent:${name}`
  const clash = await prisma.node.findUnique({ where: { id: nodeId }, select: { spaceId: true } })
  if (clash) {
    if (clash.spaceId === spaceId) return false
    throw new Error(entityNameClashDenial(name, 'agent', 'lib/agents/service.ts#createAgentBrief'))
  }

  await syncEntityNode({
    spaceId,
    type: 'agent',
    nodeId,
    name: declared.name,
    subtitle: declared.subtitle,
    metadata: { notePath: path },
    parentNodeId: spaceNodeId(spaceId),
    revalidate: false,
  })
  return true
}

/**
 * The `tool:<name>` node behind a `tools/<name>/index.md` write, created when
 * the write declares `type: tool` and no node backs it yet.
 *
 * lib/tools/service.ts#createTool already makes this node BEFORE writing the
 * note, because a Tool is folder-only: its entity note is always the index
 * path, which store.ts#enforceIndexContract holds to the entity contract —
 * with no node behind it, the contract falls back to the plain Index shape
 * and `type: tool` is silently lost. Every OTHER door into `tools/` — a
 * create-note write, a REST write, a restore from trash, an import — needs
 * the same node made, which is why this is exported: store.ts#enforceIndexContract
 * calls it directly, BEFORE enforcing the frontmatter contract (enforceIndexContract
 * runs ahead of syncContextLinks in both writeNote and createNote, so waiting
 * for this function's other caller — syncNoteNode above, reached only through
 * syncContextLinks — would be one save too late: the type would already have
 * been rewritten to `Index` by the time it ran).
 *
 * No-op (`false`) for anything else: a path that isn't a Tool's index, a name
 * TOOL_NAME_RE rejects, content that doesn't declare `type: tool`, or a node
 * that already exists in this space. Throws when the node id is already
 * claimed by ANOTHER space — the one case this can't just make its own node —
 * with a message naming createTool, exactly like createTool's own name-clash
 * refusal.
 */
export async function ensureToolNode(spaceId: string, path: string, content: string): Promise<boolean> {
  if (toolFileKindOfPath(path) !== 'index') return false
  const name = toolNameOfPath(path)
  if (!name) return false
  const declared = declaredFolderOnlyEntity(parseFrontmatter(content), 'tool', name)
  if (!declared) return false

  const nodeId = `tool:${name}`
  const clash = await prisma.node.findUnique({ where: { id: nodeId }, select: { spaceId: true } })
  if (clash) {
    if (clash.spaceId === spaceId) return false // already made — createTool, or a second hand-made save
    throw new Error(entityNameClashDenial(name, 'tool', 'lib/tools/service.ts#createTool'))
  }

  await syncEntityNode({
    spaceId,
    type: 'tool',
    nodeId,
    name: declared.name,
    subtitle: declared.subtitle,
    metadata: { notePath: path },
    parentNodeId: spaceNodeId(spaceId),
    revalidate: false,
  })
  return true
}

/**
 * The `agent:` node standing for an `agents/<name>/index.md` brief — same
 * shape as the connector node: id `agent:<name>`, description as subtitle,
 * `notePath` in metadata as the exact way back. The activation and the
 * agent's own notes are sub-notes of the folder and never reach here
 * (entityKindOfPath returns null for them). The flat alias `agents/<name>.md`
 * is accepted for a brief written before the folder era.
 */
async function syncAgentNode(spaceId: string, path: string, content: string | null): Promise<boolean> {
  if (content === null) return removeEntityNode(spaceId, 'agent', path)

  const name = agentNameOfPath(path) ?? path.replace(/\.md$/i, '').split('/').pop() ?? path
  const fm = parseFrontmatter(content)
  const description = typeof fm.description === 'string' ? fm.description.trim() : ''
  // The brief's tags are the node's: that is how the roster groups agents and
  // how the Directory's tag filter reaches them.
  const tags = (fm.tags ?? []).map((t) => String(t).trim()).filter(Boolean)

  await syncEntityNode({
    spaceId,
    type: 'agent',
    name: String(fm.title ?? '').trim() || name,
    alias: null,
    subtitle: description || null,
    recordId: path,
    slugSource: name,
    tags: [...new Set(tags)],
    metadata: { notePath: path },
    parentNodeId: spaceNodeId(spaceId),
    revalidate: false,
  })
  return true
}

/**
 * The `connector:` node standing for a `connectors/<name>.md` note.
 *
 * The node id is `connector:<name>`, which is exactly what entityNotePath maps
 * back to the note — so the connector participates in backlinks and
 * `[[mentions]]` like any other entity. Its `alias` mirrors the note's
 * frontmatter (`http` / `postgres`), which is what makes the type chip read
 * "http" wherever the node is drawn; an unparseable or missing alias leaves the
 * column null and the chip falls back to the base "Connector" label.
 */
async function syncConnectorNode(
  spaceId: string,
  path: string,
  content: string | null,
): Promise<boolean> {
  if (content === null) return removeEntityNode(spaceId, 'connector', path)

  const name = connectorNameOfPath(path) ?? path.replace(/\.md$/i, '').split('/').pop() ?? path
  const fm = parseFrontmatter(content)
  const alias = typeof fm.alias === 'string' && fm.alias.trim() ? fm.alias.trim() : null
  const description = typeof fm.description === 'string' ? fm.description.trim() : ''

  await syncEntityNode({
    spaceId,
    type: 'connector',
    name: String(fm.title ?? '').trim() || name,
    alias,
    subtitle: description || null,
    recordId: path,
    slugSource: name,
    metadata: { notePath: path },
    parentNodeId: spaceNodeId(spaceId),
    revalidate: false,
  })
  return true
}

/**
 * The `model:` node standing for a `models/<name>.md` note — the same shape as
 * a connector's, so the model participates in backlinks and `[[mentions]]`
 * and has a page. Its `alias` is the provider id (`anthropic`), which is what
 * the type chip reads wherever the node is drawn; an unparseable note leaves
 * it null and the chip falls back to "Model".
 */
async function syncModelNode(spaceId: string, path: string, content: string | null): Promise<boolean> {
  if (content === null) return removeEntityNode(spaceId, 'model', path)

  const name = path.replace(/\.md$/i, '').split('/').pop() || path
  const fm = parseFrontmatter(content)
  const provider = typeof fm.provider === 'string' && fm.provider.trim() ? fm.provider.trim().toLowerCase() : null
  const description = typeof fm.description === 'string' ? fm.description.trim() : ''

  await syncEntityNode({
    spaceId,
    type: 'model',
    name: String(fm.title ?? '').trim() || name,
    alias: provider,
    subtitle: description || null,
    recordId: path,
    slugSource: name,
    metadata: { notePath: path },
    parentNodeId: spaceNodeId(spaceId),
    revalidate: false,
  })
  return true
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

/** An excerpt entry with its hash stamped, or null for empty text. */
function excerptEntry(text: string | null | undefined) {
  return text ? { text, hash: sha256(text) } : null
}

// Sync one entity note's context links to its current mention set. `content`
// null means the note is gone (trashed / renamed away) — desired set is empty.
// Returns true when any link row changed.
async function syncOne(
  spaceId: string,
  path: string,
  content: string | null,
  maps: EntityMaps,
): Promise<boolean> {
  const selfId = ownerIdOf(path, maps)
  const keepKey = (key: string) => ownerIdOf(key, maps) !== null
  const desired =
    content !== null && selfId
      ? linkedNotePaths(path, content)
          .map((p) => ({ targetPath: p, id: maps.idByPath.get(p) }))
          .filter(
            (d): d is { targetPath: string; id: string } => Boolean(d.id) && d.id !== selfId,
          )
      : []
  const desiredPairs = new Set(selfId ? desired.map((d) => pairKeyFor(selfId, d.id)) : [])
  // The prose block around each mention — the deterministic "why linked" tier,
  // stored on the row under metadata.context (see lib/notes/context/linkReason.ts).
  const excerptByTarget =
    content !== null ? excerptsForTargets(path, splitFrontmatter(content).body) : new Map<string, string>()

  let changed = false

  // Stale links this note owns: re-point to the counterpart's note when it still
  // mentions back, otherwise delete. (Scoped to origin 'context', so a manual or
  // promoted edge between the same pair is never touched.)
  const owned = await prisma.link.findMany({
    where: { spaceId, origin: CONTEXT_ORIGIN, originRef: path },
  })
  for (const row of owned) {
    if (desiredPairs.has(row.pairKey)) continue
    const otherId = [row.sourceId, row.targetId].find((id) => id !== selfId) ?? null
    // Two ways the edge survives this note dropping it: the counterpart's own
    // note (or one of ITS sub-notes) still mentions us back, or a sibling note
    // of the same node still mentions the counterpart. Either way ownership —
    // and the "why" excerpt — moves to the surviving note.
    const heir =
      selfId && otherId
        ? ((await heirFor(spaceId, otherId, selfId, maps, path)) ??
          (await heirFor(spaceId, selfId, otherId, maps, path)))
        : null
    if (heir) {
      const heirExcerpt = excerptEntry(
        excerptsForTargets(heir.path, splitFrontmatter(heir.content).body).get(heir.target),
      )
      const prior = readLinkContextMeta(row.metadata)
      const dropped = nextContextMeta(prior, path, null, keepKey) ?? prior
      const repointed = nextContextMeta(dropped, heir.path, heirExcerpt, keepKey) ?? dropped
      await prisma.link.update({
        where: { id: row.id },
        data: {
          originRef: heir.path,
          ...(repointed ? { metadata: mergeContextMeta(row.metadata, repointed) as object } : {}),
        },
      })
    } else {
      await prisma.link.delete({ where: { id: row.id } })
    }
    changed = true
  }

  // Existing rows for the desired pairs, so each upsert can merge its excerpt
  // into the row's metadata instead of blindly replacing it (mutual mentions
  // share one row — each side owns only its own excerpt key).
  const existingByPair = selfId
    ? new Map(
        (
          await prisma.link.findMany({
            where: {
              spaceId,
              relationship: CONTEXT_RELATIONSHIP,
              pairKey: { in: [...desiredPairs] },
            },
            select: { pairKey: true, metadata: true },
          })
        ).map((row) => [row.pairKey, row.metadata]),
      )
    : new Map<string, unknown>()

  for (const { targetPath, id } of desired) {
    if (!selfId) break
    const rowMetadata = existingByPair.get(pairKeyFor(selfId, id))
    const context = nextContextMeta(
      readLinkContextMeta(rowMetadata),
      path,
      excerptEntry(excerptByTarget.get(targetPath)),
      keepKey,
    )
    await upsertLink({
      spaceId,
      sourceId: selfId,
      targetId: id,
      relationship: CONTEXT_RELATIONSHIP,
      origin: CONTEXT_ORIGIN,
      originRef: path,
      ...(context ? { metadata: mergeContextMeta(rowMetadata, context) } : {}),
      revalidate: false,
    })
    changed = true
  }

  return changed
}

/**
 * Best-effort sync of one note's place in the graph: the node it owns (only a
 * connector note owns one), then the context links its `[[mentions]]` own.
 * Every shared-context note goes through here, but only a note that IS a node —
 * an entity note or a connector — can own edges; a plain note has no node, so
 * its mentions draw nothing.
 *
 * No-op for personal contexts. Pass `content: null` when the note no longer lives
 * at `path` (trash, rename, folder delete).
 */
export async function syncContextLinks(
  context: ContextRef,
  path: string,
  content: string | null,
): Promise<void> {
  if (context.ownerKey !== SHARED_OWNER_KEY) return
  try {
    // The node must exist before syncOne runs — that's what makes `selfId`
    // resolve, and therefore what lets the note own edges at all.
    const nodeChanged = await syncNoteNode(context.spaceId, path, content)
    const maps = await loadEntityMaps(context.spaceId)
    const changed = await syncOne(context.spaceId, path, content, maps)
    if (changed || nodeChanged) bustContextCache()
    // AI tier: turn fresh excerpts into reason phrases, off the request path.
    if (changed) scheduleLinkReasons(context.spaceId)
  } catch (err) {
    logger.error('notes.contextLinks.sync.failed', { err, path, spaceId: context.spaceId })
  }
}

/**
 * Best-effort bulk sync after a folder rename/delete: `removed` paths lose
 * their links (counterpart re-point rules apply), `added` [path, content]
 * pairs gain theirs, and any node a path owns (connectors) follows it.
 *
 * A rename is modelled as remove-then-add. Entity notes are unaffected — their
 * node is keyed on the entity, not the path.
 */
export async function syncContextLinksBulk(
  context: ContextRef,
  removed: string[],
  added: Array<[path: string, content: string]> = [],
): Promise<void> {
  if (context.ownerKey !== SHARED_OWNER_KEY) return
  if (removed.length === 0 && added.length === 0) return
  try {
    let changed = false
    // Before the removes read the old paths as gone: a rename is a move, not a
    // death, and an adopted node's binding has to travel with its note.
    await repointAdoptedNodes(context.spaceId, removed, added)
    await repointConnectorNodes(context.spaceId, removed, added)
    for (const path of removed) {
      changed = (await syncNoteNode(context.spaceId, path, null)) || changed
    }
    for (const [path, content] of added) {
      changed = (await syncNoteNode(context.spaceId, path, content)) || changed
    }
    // Loaded after the node writes so newly added notes resolve to their nodes.
    const maps = await loadEntityMaps(context.spaceId)
    for (const path of removed) {
      changed = (await syncOne(context.spaceId, path, null, maps)) || changed
    }
    for (const [path, content] of added) {
      changed = (await syncOne(context.spaceId, path, content, maps)) || changed
    }
    if (changed) {
      bustContextCache()
      scheduleLinkReasons(context.spaceId)
    }
  } catch (err) {
    logger.error('notes.contextLinks.bulkSync.failed', { err, spaceId: context.spaceId })
  }
}

/**
 * Rebuild every context link in a space's shared context from its notes — the
 * backfill for notes written before context-driven links existed. Returns the
 * number of notes processed.
 */
export async function backfillContextLinks(spaceId: string): Promise<number> {
  const notes = await prisma.contextNote.findMany({
    where: { spaceId, ownerKey: SHARED_OWNER_KEY, deletedAt: null },
    select: { path: true, content: true },
  })
  let changed = false
  // Nodes first, for the whole set: a note can only own an edge once its node
  // exists, and the maps are loaded once afterwards rather than per note.
  for (const note of notes) {
    changed = (await syncNoteNode(spaceId, note.path, note.content)) || changed
  }
  const maps = await loadEntityMaps(spaceId)
  for (const note of notes) {
    changed = (await syncOne(spaceId, note.path, note.content, maps)) || changed
  }
  if (changed) bustContextCache()
  return notes.length
}
