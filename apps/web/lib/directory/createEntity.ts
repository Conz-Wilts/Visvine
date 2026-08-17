// Creating a directory entity: a typed Node plus its canonical context note, in
// one gated operation. This is THE creation path for the context layer — the
// note-first web surface (POST /api/directory/entities) and the MCP
// `add_context` tool both call it, so the id race, the write gate, the
// collision rule and identity resolution can only be implemented once.
//
// Why it's a domain function rather than just a route: the MCP server calls the
// domain layer directly (no self-HTTP hop), and duplicating any of the steps
// below would drift silently — the failure mode is a shadow node whose note
// belongs to a different entity, which nothing errors on.

import { revalidateTag } from 'next/cache'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import type { ResolvedContext } from '@/lib/notes/resolve'
import { principalOf } from '@/lib/notes/resolve'
import { writeDenial } from '@/lib/notes/contextService'
import { createNote, readNoteOrNull } from '@/lib/notes/store'
import { entityDraftContent, entityIndexPathOf, entityNotePath } from '@/lib/notes/entities'
import { applyFields } from '@/lib/create/typeFields'
import { attachIdentity } from '@/lib/identity/attachIdentity'
import type { ResolveResult } from '@/lib/identity/resolve'
import { slugify } from '@/lib/eventUtils'
import { normalizeImageUrl } from '@/lib/mediaUrl'
import { logger } from '@/lib/logger'
import type { NBNode } from '@/lib/types'
import { findAliasByRef, type SpaceAlias } from '@/lib/types/context'

/**
 * The types the context layer can create. The node TYPE is what decides
 * everything downstream — which fields exist (FIELDS_BY_TYPE in
 * lib/create/typeFields.ts), which note namespace the entity lives in
 * (ENTITY_DIRS in lib/notes/entities.ts), and whether it resolves to a
 * cross-space identity. section/channel are structural and belong to admin
 * surfaces.
 *
 * Events create here like anything else: everything in this product starts as a
 * context note, and an event is a node with a note at events/<slug>.md the same
 * way a person is. The date, RSVP, form and theme settings live on the event
 * page, which is where they're edited once the note exists — a dateless event
 * is a real, valid event that hasn't been scheduled yet (the Events page files
 * those under "Date to be set").
 *
 * A `space` here is a group, organisation or space — recorded as a card in
 * the directory. Recording one never provisions a real space: those are only
 * ever created deliberately, from the switcher. When the name resolves to one
 * that already runs here, `spaceRef` links the card to it.
 */
export const CREATABLE_TYPES = ['person', 'space', 'resource', 'event'] as const
export type CreatableType = (typeof CREATABLE_TYPES)[number]

export function isCreatableType(type: string): type is CreatableType {
  return (CREATABLE_TYPES as readonly string[]).includes(type)
}

/** How many `-2`, `-3`… suffixes to try before giving up on a free id. */
const MAX_ID_ATTEMPTS = 5

export interface CreateEntityInput {
  type: string
  name: string
  alias?: string | null
  identityId?: string | null
  /**
   * For `space` only: the space row this card refers to, set when the user
   * picked one that already runs here out of the match list. Null for an org
   * that's only a directory record — nothing is provisioned for those.
   */
  spaceRef?: string | null
  /** Flat `{ fieldKey: value }`, split into columns + metadata by `applyFields`. */
  fields?: Record<string, unknown>
  /** Markdown body appended under the generated frontmatter. */
  body?: string
  tags?: string[]
}

export type CreateEntityResult =
  | {
      ok: true
      node: NBNode
      notePath: string
      resolution: ResolveResult | null
      /** Non-fatal: the node exists but its note could not be written. */
      noteError: string | null
    }
  | {
      ok: false
      status: 400 | 403 | 409
      error: string
      existingNodeId?: string | null
      existingPath?: string
    }

const NODE_SELECT = {
  id: true, type: true, name: true, alias: true, subtitle: true, location: true,
  url: true, imageUrl: true, tags: true, metadata: true, spaceId: true, createdAt: true,
} as const

type NodeRow = Prisma.NodeGetPayload<{ select: typeof NODE_SELECT }>

function nodeRowToNBNode(row: NodeRow): NBNode {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    alias: row.alias ?? null,
    subtitle: row.subtitle ?? null,
    location: row.location ?? null,
    url: row.url ?? null,
    image_url: normalizeImageUrl(row.imageUrl),
    tags: row.tags,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    space_id: row.spaceId ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

/**
 * Create a node and its canonical context note. The caller must already have
 * resolved (and thereby authorized) the target context — membership is checked
 * there; the folder-level write gate is checked here, because it depends on the
 * note path the type implies.
 *
 * Never throws for expected failures: bad type, denied write and "already
 * exists" all come back as `{ ok: false }` with the status the HTTP route
 * should use.
 */
export async function createEntity(
  context: ResolvedContext,
  input: CreateEntityInput,
): Promise<CreateEntityResult> {
  const rawType = input.type.trim().toLowerCase()
  const name = input.name.trim()
  if (!rawType || !name) {
    return { ok: false, status: 400, error: 'type and name are required' }
  }
  if (!isCreatableType(rawType)) {
    return { ok: false, status: 400, error: `Cannot create a "${rawType}" from here` }
  }

  // The slug, not the raw name, decides whether a title is usable: "???" is a
  // non-empty string that slugs to nothing and would yield the id `person:`.
  const slug = slugify(name)
  if (!slug) {
    return { ok: false, status: 400, error: 'Name must contain at least one letter or number' }
  }

  const tags = (input.tags ?? []).filter((t) => typeof t === 'string' && t.trim() !== '')
  const { node: columns, metadata } = applyFields(rawType, input.fields ?? {})

  // An alias must be one this space actually defines for this type. Writing the
  // caller's string verbatim is how `founder` ended up stored against a
  // `Founder` vocabulary, matching nothing thereafter; resolving it here stores
  // the canonical name and the id it belongs to. An unknown alias is dropped
  // rather than refused — the entity is still worth creating.
  const alias = input.alias?.trim()
    ? findAliasByRef(
        (
          await prisma.space.findUnique({
            where: { id: context.spaceId },
            select: { aliases: true },
          })
        )?.aliases as unknown as SpaceAlias[],
        input.alias,
        rawType,
      )
    : undefined

  // The note path depends only on the entity KIND, not on the id suffix we may
  // end up with, so it's known before the insert — which is what lets the write
  // gate and the collision check run first.
  const basePath = entityNotePath({ id: `${rawType}:${slug}`, type: rawType })
  if (!basePath) {
    return { ok: false, status: 400, error: `"${rawType}" has no context-note namespace` }
  }

  const principal = await principalOf(context)
  const denial = writeDenial(principal, context, basePath)
  if (denial) return { ok: false, status: 403, error: denial }

  // Collision check against the NOTE, not just the node id. `entityNotePath` is
  // lossy in the organisation namespace — legacy `org:halter`, `group:halter`,
  // `community:halter` and a new `space:halter` all land on communities/halter.md — so an id
  // that looks free can still point at an occupied path. Hand back the existing node so the
  // caller can offer "already exists — open it" instead of silently creating a
  // second Halter that shadows the first one's note.
  //
  // The id lookup is a best-effort hint by name: the path→node direction isn't
  // expressible in SQL (entityNotePath is applied in JS over real nodes), and a
  // null just means the caller offers the note rather than the profile.
  // Either form of the note counts — the entity may already have become a folder.
  const indexPath = entityIndexPathOf({ id: `${rawType}:${slug}`, type: rawType })
  if (
    (await readNoteOrNull(context, basePath)) ||
    (indexPath && (await readNoteOrNull(context, indexPath)))
  ) {
    const existing = await prisma.node.findFirst({
      where: { spaceId: context.spaceId, name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    })
    return {
      ok: false,
      status: 409,
      error: `${name} already exists in this space`,
      existingNodeId: existing?.id ?? null,
      existingPath: basePath,
    }
  }

  // ── Race-free id: the uniqueness check IS the insert ──────────────────────
  const baseId = `${rawType}:${slug}`
  let row: NodeRow | null = null
  for (let attempt = 1; attempt <= MAX_ID_ATTEMPTS; attempt++) {
    const id = attempt === 1 ? baseId : `${baseId}-${attempt}`
    try {
      row = await prisma.node.create({
        data: {
          id,
          // Stored lowercase-canonical: eventRepo and mention lookups filter on
          // exact lowercase; rendering resolves case-insensitively.
          type: rawType,
          name,
          alias: alias?.name ?? null,
          aliasId: alias?.id ?? null,
          subtitle: columns.subtitle ?? null,
          location: columns.location ?? null,
          url: columns.url ?? null,
          imageUrl: columns.image_url ?? null,
          tags,
          metadata: metadata as Prisma.InputJsonObject,
          spaceId: context.spaceId,
        },
        select: NODE_SELECT,
      })
      break
    } catch (err) {
      const taken = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
      if (!taken) throw err
      // Someone else took this id between our check and our insert — suffix and retry.
    }
  }
  if (!row) {
    return {
      ok: false,
      status: 409,
      error: 'Could not find a free id for that name — try a more specific name',
    }
  }

  // Identity runs AFTER the insert so it binds the id that actually won the
  // race, not the one we hoped for.
  const { identityId, resolution } = await attachIdentity(nodeRowToNBNode(row), {
    identityId: input.identityId ?? null,
    actorUserId: context.actor.id,
  })
  if (identityId) {
    await prisma.node.update({ where: { id: row.id }, data: { identityId } })
  }

  // An organisation the user RESOLVED to a space that already runs here
  // keeps a pointer to it, so the card and the real thing are the same thing.
  // Nothing is provisioned when it doesn't resolve: recording that Movac exists
  // is a note in your directory, and real spaces are only ever created
  // deliberately, from the switcher. An unresolved card is just a card.
  const spaceRef = rawType === 'space' ? input.spaceRef?.trim() : null
  if (spaceRef) {
    row = await prisma.node.update({
      where: { id: row.id },
      data: { metadata: { ...metadata, spaceRef } as Prisma.InputJsonObject },
      select: NODE_SELECT,
    })
  }

  // The note path follows the id that won, so a suffixed `person:jane-2` gets
  // people/jane-2.md rather than colliding on people/jane.md.
  const notePath = entityNotePath({ id: row.id, type: rawType }) ?? basePath
  const content = entityDraftContent(
    { id: row.id, type: rawType, name, subtitle: columns.subtitle ?? null },
    { tags, body: input.body ?? '' },
  )

  let noteError: string | null = null
  try {
    await createNote(context, notePath, content, context.actor)
  } catch (err) {
    // "already exists" is benign (a concurrent create won). Anything else is
    // reported but NOT fatal — the node is real, and the context tab seeds the
    // stub locally, so the user keeps going and the next save creates the note.
    const message = err instanceof Error ? err.message : 'Failed to create the note'
    if (!/already exists/i.test(message)) {
      noteError = message
      logger.error('directory.createEntity.note.failed', { err, nodeId: row.id, notePath })
    }
  }

  revalidateTag('context-data-v2', { expire: 0 })
  return { ok: true, node: nodeRowToNBNode(row), notePath, resolution, noteError }
}
