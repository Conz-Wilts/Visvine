// The note-first create commit: turns a filled-in draft into a real directory
// node AND its canonical context note in one gated call.
//
//   POST { communityId, type, name, alias?, identityId?, fields?, body?, tags? }
//     → 201 { node, notePath, resolution, noteError? }
//     → 409 { error, existingNodeId, existingPath }
//     → 403 { error }
//
// Why this exists alongside POST /api/data/nodes:
//
//  * Permissions. /api/data/nodes is the admin-only bulk/Data-tab surface. Here
//    the rule is "if you could write people/craig.md by hand, you can create
//    Craig" — active membership plus the brain's own write gate at the target
//    note path. That's strictly narrower than the tags PATCH on
//    /api/nodes/[nodeId], which already lets any member mutate a node.
//
//  * Id uniqueness. The create modal used to GET the ENTIRE node list to dedupe
//    ids client-side, then POST — two people adding "Jane" at the same moment
//    both saw `person:jane` free and the loser got an opaque 500. Here the
//    uniqueness check IS the insert: create in a loop, catch P2002, suffix, retry.
//
//  * Atomicity of intent. The node and its note are one user action, so one
//    request makes them. A note failure still returns 201 — the node exists and
//    EntityContextPanel seeds a stub locally for a missing note, so the user is
//    never stranded mid-create.

import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { requireBrain, fail } from '@/lib/notes/api'
import { principalOf } from '@/lib/notes/brain'
import { writeDenial } from '@/lib/notes/brainService'
import { createNote, readNoteOrNull } from '@/lib/notes/store'
import { entityDraftContent, entityNotePath } from '@/lib/notes/entities'
import { applyFields } from '@/lib/create/typeFields'
import { attachIdentity } from '@/lib/identity/attachIdentity'
import { slugify } from '@/lib/eventUtils'
import { normalizeImageUrl } from '@/lib/mediaUrl'
import { handleApiError } from '@/lib/api/route'
import { logger } from '@/lib/logger'
import type { NBNode } from '@/lib/types'

/** Types the note-first surface can commit. Events are deferred (their detail
 *  route redirects to /events/<id>, whose tab state isn't in the URL yet). */
const CREATABLE = new Set(['person', 'group', 'resource'])

/** How many `-2`, `-3`… suffixes to try before giving up on a free id. */
const MAX_ID_ATTEMPTS = 5

function nodeRowToNBNode(row: {
  id: string; type: string; name: string; alias: string | null; subtitle: string | null
  location: string | null; url: string | null; imageUrl: string | null
  tags: string[]; metadata: unknown; communityId: string | null; createdAt: Date
}): NBNode {
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
    community_id: row.communityId ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

const NODE_SELECT = {
  id: true, type: true, name: true, alias: true, subtitle: true, location: true,
  url: true, imageUrl: true, tags: true, metadata: true, communityId: true, createdAt: true,
} as const

type NodeRow = Prisma.NodeGetPayload<{ select: typeof NODE_SELECT }>

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const brain = await requireBrain(req, body)
    if (brain instanceof Response) return brain

    const rawType = typeof body.type === 'string' ? body.type.trim().toLowerCase() : ''
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!rawType || !name) return fail('type and name are required')
    if (!CREATABLE.has(rawType)) return fail(`Cannot create a "${rawType}" from here`)

    // The slug, not the raw name, decides whether a title is usable: "???" is a
    // non-empty string that slugs to nothing and would yield the id `person:`.
    const slug = slugify(name)
    if (!slug) return fail('Name must contain at least one letter or number')

    const tags = Array.isArray(body.tags)
      ? body.tags.filter((t: unknown): t is string => typeof t === 'string' && t.trim() !== '')
      : []
    const fields = (body.fields ?? {}) as Record<string, unknown>
    const { node: columns, metadata } = applyFields(rawType, fields)

    // The note path depends only on the entity KIND, not on the id suffix we may
    // end up with, so it's known before the insert — which is what lets the
    // write gate and the collision check run first.
    const basePath = entityNotePath({ id: `${rawType}:${slug}`, type: rawType })
    if (!basePath) return fail(`"${rawType}" has no context-note namespace`)

    const principal = await principalOf(brain)
    const denial = writeDenial(principal, brain, basePath)
    if (denial) return fail(denial, 403)

    // Collision check against the NOTE, not just the node id. `entityNotePath`
    // is lossy in the org namespace — legacy `org:halter`, `organization:halter`
    // and a new `group:halter` all land on companies/halter.md — so an id that
    // looks free can still point at an occupied path. Hand back the existing
    // node so the client can offer "already exists — open it" instead of
    // silently creating a second Halter that shadows the first one's note.
    //
    // The id lookup is a best-effort hint by name: the path→node direction isn't
    // expressible in SQL (entityNotePath is applied in JS over real nodes), and a
    // null just means the client offers the note rather than the profile.
    if (await readNoteOrNull(brain, basePath)) {
      const existing = await prisma.node.findFirst({
        where: { communityId: brain.communityId, name: { equals: name, mode: 'insensitive' } },
        select: { id: true },
      })
      return NextResponse.json(
        {
          error: `${name} already exists in this community`,
          existingNodeId: existing?.id ?? null,
          existingPath: basePath,
        },
        { status: 409 },
      )
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
            alias: typeof body.alias === 'string' && body.alias.trim() ? body.alias.trim() : null,
            subtitle: columns.subtitle ?? null,
            location: columns.location ?? null,
            url: columns.url ?? null,
            imageUrl: columns.image_url ?? null,
            tags,
            metadata: metadata as Prisma.InputJsonObject,
            communityId: brain.communityId,
          },
          select: NODE_SELECT,
        })
        break
      } catch (err) {
        const taken =
          err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
        if (!taken) throw err
        // Someone else took this id between our check and our insert — suffix and retry.
      }
    }
    if (!row) return fail('Could not find a free id for that name — try a more specific name', 409)

    // Identity runs AFTER the insert so it binds the id that actually won the
    // race, not the one we hoped for.
    const { identityId, resolution } = await attachIdentity(nodeRowToNBNode(row), {
      identityId: typeof body.identityId === 'string' ? body.identityId : null,
      actorUserId: brain.actor.id,
    })
    if (identityId) {
      await prisma.node.update({ where: { id: row.id }, data: { identityId } })
    }

    // The note path follows the id that won, so a suffixed `person:jane-2` gets
    // people/jane-2.md rather than colliding on people/jane.md.
    const notePath = entityNotePath({ id: row.id, type: rawType }) ?? basePath
    const content = entityDraftContent(
      { id: row.id, type: rawType, name, subtitle: columns.subtitle ?? null },
      { tags, body: typeof body.body === 'string' ? body.body : '' },
    )

    let noteError: string | null = null
    try {
      await createNote(brain, notePath, content, brain.actor)
    } catch (err) {
      // "already exists" is benign (a concurrent create won). Anything else is
      // reported but NOT fatal — the node is real, and the context tab seeds the
      // stub locally, so the user keeps going and the next save creates the note.
      const message = err instanceof Error ? err.message : 'Failed to create the note'
      if (!/already exists/i.test(message)) {
        noteError = message
        logger.error('api.directory.entities.note.failed', { err, nodeId: row.id, notePath })
      }
    }

    revalidateTag('context-data-v2')
    return NextResponse.json(
      { node: nodeRowToNBNode(row), notePath, resolution, noteError },
      { status: 201 },
    )
  } catch (err) {
    return handleApiError(err, 'api.directory.entities.post.failed')
  }
}
