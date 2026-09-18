/**
 * The single "this thing now exists — give it context" path.
 *
 * Everything a user can create (a space, a channel, a person, an
 * event, a note, an uploaded file) should be reachable in two places: the
 * context graph as a `Node`, and the context as a markdown note that records what
 * we know about it. Before this module every call site hand-wrote
 * `prisma.node.create` + `revalidateTag`, which is exactly why spaces,
 * channels, notes and files never made it into the graph at all.
 *
 * Two kinds of thing go through here:
 *
 *  * **Records and containers** (person, resource, event, space, channel)
 *    get BOTH a node and a canonical note under their fixed
 *    namespace — `sections/general.md`, `channels/announcements.md`, and so on.
 *  * **Documents** (a note, an uploaded file) get ONLY a node: the artifact IS
 *    its own context, and writing a second `.md` about a `.md` is noise.
 *
 * Everything here is idempotent. Re-running a create, or the backfill, upserts
 * the node, tolerates an existing note, and re-asserts the containment edge —
 * `upsertLink` dedups on (space, pair, relationship) and never demotes a
 * manual edge, so a second pass is a no-op rather than a duplicate.
 */
import { revalidateTag } from 'next/cache'
import { purgeNodeObjects } from '@/lib/storage/purge'
import { Prisma } from '@prisma/client'
import prisma from '../../prisma'
import { slugify } from '../../eventUtils'
import { logger } from '../../logger'
import { createNote, readNoteOrNull, writeNote, SHARED_OWNER_KEY, type Actor } from '../store'
import { joinFrontmatter, parseFrontmatter, splitFrontmatter } from '../shared/markdown'
import { entityDraftContent, entityKindOf, entityNotePath } from '../entities'
import { spaceNodeId } from '../../types/context'
import { mirroredFields, type EntityRecord } from './mirroredFields'
import { upsertLink } from './links'

/** The node `type` values this module knows how to place in the graph. */
export type EntityNodeType =
  | 'person'
  | 'resource'
  | 'event'
  | 'space'
  | 'section'
  | 'channel'
  | 'connector'
  | 'agent'
  | 'tool'
  | 'model'

/** Document kinds: their own artifact is the context, so no `.md` is written. */
// A connector counts as a document even though it lives in an entity namespace:
// the admin authored connectors/<name>.md first and the node follows it, so
// there is nothing left to write. An agent is note-first in exactly the same
// way, and so is a tool — whose note is a whole folder (lib/tools/service.ts
// writes the index and the two sources itself).
const DOCUMENT_TYPES = new Set<EntityNodeType>(['connector', 'agent', 'tool', 'model'])

/** The containment relationship every structural edge uses. */
const CONTAINS_RELATIONSHIP = 'contains'

/**
 * The metadata key holding the underlying record's primary key, per type. Node
 * ids are human slugs (`space:general`) so the note path reads well, which
 * means the id is NOT the record id — this is how we find the node again for a
 * given ChannelSection/Conversation/ContextSource without a second table.
 */
// The metadata KEYS keep their pre-rename names (`spaceRef`, `sectionId`) —
// they're stored data, not display vocabulary.
const RECORD_KEY: Partial<Record<EntityNodeType, string>> = {
  person: 'userId',
  space: 'spaceRef',
  resource: 'fileId',
  section: 'sectionId',
  channel: 'conversationId',
  connector: 'notePath',
  agent: 'notePath',
  tool: 'notePath',
}

/** Writes made by a background job rather than a signed-in person. */
const SYSTEM_ACTOR: Actor = { id: 'system', name: 'Visvine', email: null }

/**
 * How many `-2`, `-3`… suffixes to try before giving up on a free node id. Node
 * ids are global, so the same member in many spaces takes one suffix per space —
 * a low ceiling would leave them without a node in the space after it.
 */
const MAX_ID_ATTEMPTS = 25

export interface SyncEntityNodeInput {
  spaceId: string
  type: EntityNodeType
  /** Display name — also the slug source when `slugSource` is omitted. */
  name: string
  /** The underlying record's id (ChannelSection.id, Conversation.id, note path…). */
  recordId?: string | null
  /** Override the slug the node id and note path are derived from. */
  slugSource?: string | null
  /**
   * Pin the node id instead of deriving it. Only for things whose id is already
   * a stable global slug — a space, whose own id IS the slug, so the node
   * for `blackbird` is always `space:blackbird` and callers can name it
   * without a lookup (see {@link spaceNodeId}).
   */
  nodeId?: string | null
  subtitle?: string | null
  location?: string | null
  url?: string | null
  imageUrl?: string | null
  /**
   * Free text written straight to `Node.alias`, NOT a space alias: the only
   * caller is the connector sync, where it carries the executor kind from the
   * note's frontmatter. `aliasId` is deliberately never set from here — that
   * column means "an alias in this space's vocabulary", which this is not.
   *
   * Omit to leave the column alone: events reuse `alias` for their public /e/<slug>
   * slug, so blindly writing null here would break their share links.
   */
  alias?: string | null
  tags?: string[]
  metadata?: Record<string, unknown>
  /** Starting text for the canonical note. Ignored for document types. */
  body?: string
  /**
   * Skip writing the canonical note. For creates that shouldn't plant the
   * entity's namespace folder in an otherwise-empty context — the Context tab
   * stubs a missing note locally and the first real save creates it.
   */
  skipNote?: boolean
  /** Who to attribute the note to. Defaults to {@link SYSTEM_ACTOR}. */
  actor?: Actor | null
  /** Parent to draw a `contains` edge from (usually `space:<id>`). */
  parentNodeId?: string | null
  /** Set false to batch cache busts across a loop (the backfill does). */
  revalidate?: boolean
}

export interface SyncEntityNodeResult {
  nodeId: string
  notePath: string | null
  /** Non-null when the node exists but its note could not be written. */
  noteError: string | null
}

// Lives in lib/types/context.ts (alongside its sibling `isOwnSpaceNode`) so
// client components can reach it — this module imports prisma. Re-exported here
// because every server call site has always asked entityNodes for the
// space's node id.
export { spaceNodeId }

function bustContextCache(): void {
  // revalidateTag throws outside a Next.js request scope (scripts, tests).
  try {
    revalidateTag('context-data-v2', { expire: 0 })
  } catch {
    /* outside request scope */
  }
}

/**
 * Pre-rename spellings that may still sit on stored rows until
 * scripts/rename-space-to-space.ts has run against that database. Matching
 * them here keeps the sync idempotent across the deploy→migrate window instead
 * of spawning `-2` suffixed duplicates or losing track of a record's node.
 */
const LEGACY_TYPE_SPELLINGS: Partial<Record<EntityNodeType, string[]>> = {
  section: ['space'],
  space: ['group', 'organization', 'organisation', 'org', 'company'],
}

function typeSpellings(type: EntityNodeType): string[] {
  return [type, ...(LEGACY_TYPE_SPELLINGS[type] ?? [])]
}

function sameEntityType(stored: string, type: EntityNodeType): boolean {
  return typeSpellings(type).includes(stored.toLowerCase())
}

/**
 * The node id for an already-synced record, or null. Looked up by the record id
 * stashed in metadata, so a renamed space keeps its node (and its note, and
 * its position on the canvas) instead of sprouting a second one.
 */
export async function findNodeIdByRecord(
  spaceId: string,
  type: EntityNodeType,
  recordId: string,
): Promise<string | null> {
  const key = RECORD_KEY[type]
  if (!key) return null
  const row = await prisma.node.findFirst({
    where: {
      spaceId,
      type: { in: typeSpellings(type) },
      metadata: { path: [key], equals: recordId },
    },
    select: { id: true },
  })
  return row?.id ?? null
}

/**
 * Ensure a node's canonical context note exists, creating the stub if it
 * doesn't. Never overwrites: an existing note is the entity's history and is
 * always more valuable than a freshly generated stub.
 *
 * Separate from {@link syncEntityNode} because events already own their node
 * row (eventRepo writes it with poster/slug columns this module knows nothing
 * about) and only need the note half.
 */
export async function ensureEntityNote(
  spaceId: string,
  node: { id: string; type: string; name?: string | null; subtitle?: string | null },
  opts: { tags?: string[]; body?: string; actor?: Actor | null } = {},
): Promise<{ notePath: string | null; noteError: string | null; created: boolean }> {
  if (!entityKindOf(node.type)) return { notePath: null, noteError: null, created: false }
  const notePath = entityNotePath(node)
  if (!notePath) return { notePath: null, noteError: null, created: false }
  try {
    await createNote(
      { spaceId, ownerKey: SHARED_OWNER_KEY },
      notePath,
      entityDraftContent(node, { tags: opts.tags, body: opts.body }),
      opts.actor ?? SYSTEM_ACTOR,
    )
  } catch (err) {
    // "already exists" is the idempotent case — the note is there, done.
    const message = err instanceof Error ? err.message : 'Failed to create the note'
    if (!/already exists/i.test(message)) {
      logger.error('context.entityNode.note.failed', { err, nodeId: node.id, notePath })
      return { notePath, noteError: message, created: false }
    }
    // The note was already there — the idempotent case, not a creation.
    return { notePath, noteError: null, created: false }
  }
  return { notePath, noteError: null, created: true }
}

/**
 * Keep an entity note's frontmatter in step with its record: `title:` for
 * every kind, plus the event schedule. The body is never touched — the note is
 * what people wrote about the thing, the frontmatter is what the record says
 * it is. Best-effort: a missing note is fine (the Context tab stubs it), a
 * failed write is logged and swallowed so the record save still succeeds.
 */
export async function syncEntityNoteFrontmatter(
  node: EntityRecord,
  actor: Actor = SYSTEM_ACTOR,
): Promise<void> {
  const notePath = entityNotePath(node)
  if (!notePath) return
  const context = { spaceId: node.spaceId, ownerKey: SHARED_OWNER_KEY }
  try {
    const content = await readNoteOrNull(context, notePath)
    if (content === null) return
    const frontmatter = parseFrontmatter(content)
    const next = { ...frontmatter }
    if (node.name) next.title = node.name
    for (const [key, value] of Object.entries(await mirroredFields(node))) {
      if (value === null || value === undefined || value === '') delete next[key]
      else next[key] = value
    }
    const changed = Object.keys({ ...frontmatter, ...next }).some(
      (key) => JSON.stringify(frontmatter[key]) !== JSON.stringify(next[key]),
    )
    if (!changed) return
    const { body } = splitFrontmatter(content)
    await writeNote(context, notePath, joinFrontmatter(next, body), actor)
  } catch (err) {
    logger.error('context.entityNote.sync.failed', { err, nodeId: node.id, notePath })
  }
}

/**
 * Create or update the node for an entity, and ensure its canonical note.
 *
 * The node id is `<type>:<slug>`, suffixed `-2`, `-3`… on collision — node ids
 * are globally unique, not per-space, so two spaces that both have a
 * "General" section land on `section:general` and `section:general-2`. That's the same
 * rule the note-first entity create already uses (app/api/directory/entities).
 *
 * A note failure is reported, never thrown: the node is real and useful on its
 * own, and the caller's primary write (creating the actual channel) must not
 * fail because the context rejected a path.
 */
export async function syncEntityNode(input: SyncEntityNodeInput): Promise<SyncEntityNodeResult> {
  const { spaceId, type } = input
  const name = input.name.trim() || type
  const recordId = input.recordId ?? null

  const metadata: Record<string, unknown> = { ...(input.metadata ?? {}) }
  const recordKey = RECORD_KEY[type]
  if (recordKey && recordId) metadata[recordKey] = recordId

  const nodeData = {
    type,
    name,
    subtitle: input.subtitle ?? null,
    location: input.location ?? null,
    url: input.url ?? null,
    // Only written when the caller actually passed one, like `alias` below —
    // a structural re-sync must not wipe an image set from another surface.
    ...(input.imageUrl === undefined ? {} : { imageUrl: input.imageUrl }),
    // Only written when the caller actually passed one — see SyncEntityNodeInput.alias.
    ...(input.alias === undefined ? {} : { alias: input.alias }),
    tags: input.tags ?? [],
    metadata: metadata as Prisma.InputJsonObject,
    spaceId,
  }

  // Already synced? Update in place — the id (and therefore the note path and
  // the saved canvas position) must survive a rename.
  let nodeId = input.nodeId ?? (recordId ? await findNodeIdByRecord(spaceId, type, recordId) : null)
  if (input.nodeId) {
    await prisma.node.upsert({
      where: { id: input.nodeId },
      create: { id: input.nodeId, ...nodeData },
      update: nodeData,
      select: { id: true },
    })
  } else if (nodeId) {
    await prisma.node.update({ where: { id: nodeId }, data: nodeData })
  } else {
    const slug = slugify(input.slugSource ?? name) || slugify(recordId ?? '') || type
    const baseId = `${type}:${slug}`
    for (let attempt = 1; attempt <= MAX_ID_ATTEMPTS && !nodeId; attempt++) {
      const candidate = attempt === 1 ? baseId : `${baseId}-${attempt}`
      const existing = await prisma.node.findUnique({
        where: { id: candidate },
        select: { spaceId: true, type: true },
      })
      if (existing) {
        // Adopt the node only when it's the same kind of thing in the same
        // space — that's the pre-backfill row for this very record, and
        // updating it in place is exactly right. Anything else just got to the
        // slug first (node ids are global), so move to the next suffix.
        // Legacy spellings count as the same kind (see LEGACY_TYPE_SPELLINGS).
        if (existing.spaceId !== spaceId || !sameEntityType(existing.type, type)) continue
        await prisma.node.update({ where: { id: candidate }, data: nodeData })
        nodeId = candidate
        break
      }
      try {
        const row = await prisma.node.create({
          data: { id: candidate, ...nodeData },
          select: { id: true },
        })
        nodeId = row.id
      } catch (err) {
        // Someone took this id between the check and the insert — suffix, retry.
        const taken = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
        if (!taken) throw err
      }
    }
  }
  if (!nodeId) {
    throw new Error(`Could not find a free node id for "${name}"`)
  }
  const id = nodeId

  // The canonical note. Documents are their own note, so they skip this.
  const { notePath, noteError } = DOCUMENT_TYPES.has(type) || input.skipNote
    ? { notePath: null as string | null, noteError: null as string | null }
    : await ensureEntityNote(
        spaceId,
        { id, type, name, subtitle: input.subtitle ?? null },
        { tags: input.tags, body: input.body, actor: input.actor },
      )

  // `Link.sourceId` is a FK onto `nodes`, so a parent that hasn't been synced yet
  // (an old space meeting this code for the first time) would make the whole
  // call fail on a foreign key. The node itself is the valuable part — skip the
  // edge and let the backfill, which syncs the space first, draw it later.
  const parentExists =
    input.parentNodeId != null &&
    (await prisma.node.count({ where: { id: input.parentNodeId } })) > 0

  if (parentExists && input.parentNodeId && input.parentNodeId !== id) {
    await upsertLink({
      spaceId,
      sourceId: input.parentNodeId,
      targetId: id,
      relationship: CONTAINS_RELATIONSHIP,
      origin: 'structure',
      originRef: id,
      revalidate: false,
    })
  }

  if (input.revalidate !== false) bustContextCache()
  return { nodeId: id, notePath, noteError }
}

/**
 * Best-effort {@link syncEntityNode} for callers whose primary write has already
 * succeeded. A space that fails to gain a context node is a degraded
 * space, not a failed create, so this swallows and logs.
 */
export async function syncEntityNodeSafe(
  input: SyncEntityNodeInput,
): Promise<SyncEntityNodeResult | null> {
  try {
    return await syncEntityNode(input)
  } catch (err) {
    logger.error('context.entityNode.sync.failed', {
      err,
      spaceId: input.spaceId,
      type: input.type,
      name: input.name,
    })
    return null
  }
}

/**
 * Remove the node for a deleted record. Links go with it — `Link.sourceId` and
 * `targetId` are FKs onto `nodes` with onDelete: Cascade, so the containment
 * edge and any `mentioned` edges disappear in the same statement.
 *
 * Note that this does NOT delete the entity's note: a channel can be deleted
 * while what we learned about it stays worth keeping. Trashing the note is the
 * user's call, from the context.
 */
export async function removeEntityNode(
  spaceId: string,
  type: EntityNodeType,
  recordId: string,
): Promise<boolean> {
  try {
    const nodeId = await findNodeIdByRecord(spaceId, type, recordId)
    if (!nodeId) return false
    await purgeNodeObjects([nodeId]).catch(() => {})
    await prisma.node.delete({ where: { id: nodeId } })
    bustContextCache()
    return true
  } catch (err) {
    logger.error('context.entityNode.remove.failed', { err, spaceId, type, recordId })
    return false
  }
}

/**
 * Re-point a channel's containment edge after it moves between spaces (or is
 * unfiled back to the space). Deleting the old edge first is what keeps a
 * moved channel from reading as contained by two parents at once.
 */
export async function reparentEntityNode(
  spaceId: string,
  nodeId: string,
  parentNodeId: string,
): Promise<void> {
  await prisma.link.deleteMany({
    where: { spaceId, origin: 'structure', originRef: nodeId },
  })
  // Same foreign-key guard syncEntityNode applies: unfiling points a channel at
  // `space:<id>`, and a space created after we stopped making a node for
  // itself simply has no such row. Dropping the old edge and leaving the channel
  // top-level is the right outcome there — a throw would fail the space delete.
  if ((await prisma.node.count({ where: { id: parentNodeId } })) === 0) {
    bustContextCache()
    return
  }
  await upsertLink({
    spaceId,
    sourceId: parentNodeId,
    targetId: nodeId,
    relationship: CONTAINS_RELATIONSHIP,
    origin: 'structure',
    originRef: nodeId,
    revalidate: false,
  })
  bustContextCache()
}
