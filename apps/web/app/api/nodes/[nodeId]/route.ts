/**
 * Node profile API — returns full node data with connection + space counts
 * GET /api/nodes/[nodeId]
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import prisma from '@/lib/prisma';
import { spaceMemberForbidden } from '@/lib/auth';
import { isSuperAdmin } from '@/lib/session';
import { isGlobalSpace } from '@/lib/spaces/globalSpace';
import { GLOBAL_MODE_KEY, syncGlobalRecordSafe } from '@/lib/global/record';
import { requireApiSession } from '@/lib/api/route';
import { syncEntityNoteFrontmatter } from '@/lib/notes/context/entityNodes';

const MAX_NAME_LEN = 120;

/** Metadata keys clients may not write through the generic property-row patch.
 *  `userId` is the person-node record key the entity sync finds nodes by —
 *  forging it would let any member re-point a person context at another record. */
const RESERVED_METADATA_KEYS = ['userId'];

type RouteContext = {
  params: Promise<{ nodeId: string }>;
};

const MAX_TAGS = 30;
const MAX_TAG_LEN = 40;

/** Normalise an incoming tag list: coerce to trimmed strings, drop blanks,
 *  cap length, dedupe case-insensitively (first spelling wins), cap count. */
function cleanTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const tag = raw.trim().slice(0, MAX_TAG_LEN);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const { nodeId } = await context.params;

  // Single parallel fetch: node, links, and all potentially connected nodes
  // Use a raw query to get links + connected node data in one shot
  const [node, linksWithNodes] = await Promise.all([
    prisma.node.findUnique({
      where: { id: nodeId },
      select: { id: true, type: true, name: true, subtitle: true, location: true, url: true, imageUrl: true, tags: true, metadata: true, alias: true, spaceId: true, createdAt: true, identity: { select: { userId: true } } },
    }),
    prisma.$queryRaw<Array<{
      source_id: string;
      target_id: string;
      relationship: string;
      since: string | null;
      connected_id: string;
      connected_name: string | null;
      connected_type: string | null;
      connected_image_url: string | null;
      connected_subtitle: string | null;
    }>>`
      SELECT
        l.source_id, l.target_id, l.relationship, l.since,
        n.id as connected_id, n.name as connected_name, n.type as connected_type,
        n.image_url as connected_image_url, n.subtitle as connected_subtitle
      FROM links l
      LEFT JOIN nodes n ON n.id = CASE
        WHEN l.source_id = ${nodeId} THEN l.target_id
        ELSE l.source_id
      END
      WHERE l.source_id = ${nodeId} OR l.target_id = ${nodeId}
    `,
  ]);

  if (!node) {
    return NextResponse.json({ error: 'Node not found' }, { status: 404 });
  }

  // The node's profile + full connection graph are space-scoped confidential
  // data: only an active member (or admin) of its space may read them. A
  // personal space is likewise private to its owner. Anyone else gets a 404 so
  // the endpoint reveals nothing — not even that the node exists.
  if (node.spaceId && (await spaceMemberForbidden(session.userId, node.spaceId, session.email))) {
    return NextResponse.json({ error: 'Node not found' }, { status: 404 });
  }

  // The member this node is connected to: the identity link is canonical;
  // the Person-id lookup below covers legacy rows the backfill hasn't touched.
  let connectedUserId: string | null = node.identity?.userId ?? null;

  // Real shared-space count: spaces where both the viewer and the
  // profile's linked user are active members. Nodes without a linked user
  // exist in exactly their own space.
  let spaceCount = 1;
  if (nodeId.startsWith('person:')) {
    const person = connectedUserId
      ? { userId: connectedUserId }
      : await prisma.person.findUnique({ where: { id: nodeId }, select: { userId: true } });
    if (person?.userId) {
      connectedUserId = person.userId;
      spaceCount = Math.max(1, await prisma.spaceMember.count({
        where: {
          userId: person.userId,
          status: 'active',
          space: {
            personalOwnerId: null, // personal spaces aren't spaces
            members: { some: { userId: session.userId, status: 'active' } },
          },
        },
      }));
    }
  }

  const resolvedConnections = linksWithNodes.map(l => ({
    id: l.connected_id,
    name: l.connected_name ?? l.connected_id,
    type: l.connected_type ?? 'person',
    image_url: l.connected_image_url ?? undefined,
    subtitle: l.connected_subtitle ?? undefined,
    relationship: l.relationship,
    since: l.since ?? undefined,
  }));

  return NextResponse.json(
    {
      node: {
        id: node.id,
        type: node.type,
        name: node.name,
        subtitle: node.subtitle,
        location: node.location,
        url: node.url,
        tags: node.tags,
        image_url: node.imageUrl ?? undefined,
        metadata: node.metadata as Record<string, unknown>,
        alias: node.alias ?? undefined,
        space_id: node.spaceId ?? undefined,
        connected_user_id: connectedUserId ?? undefined,
        createdAt: node.createdAt.toISOString(),
      },
      connectionCount: linksWithNodes.length,
      spaceCount,
      connections: resolvedConnections,
    },
    {
      headers: {
        'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
      },
    }
  );
}

/** Node columns the property rows may write. Everything else is metadata, and
 *  identity/type stay off-limits here — retyping an entity is a four-sided
 *  migration (link FKs, identity attachment, note frontmatter)
 *  and belongs to a dedicated endpoint, not an incidental field edit. `name` IS
 *  patchable: node ids and note paths are minted once and never re-derived, so
 *  a rename is pure display metadata. */
const PATCHABLE_COLUMNS = {
  subtitle: 'subtitle',
  location: 'location',
  url: 'url',
  image_url: 'imageUrl',
} as const;

/**
 * PATCH /api/nodes/[nodeId] — update an entity's tags, property rows, and
 * display name from its context note. Body: { spaceId, name?, tags?,
 * metadata?, subtitle?, location?, url?, image_url? }. Gated on active
 * membership of the node's own space
 * (the same audience that can read/write the space context); these are shared
 * collaborative metadata, so any member with write access may edit them.
 *
 * `metadata` MERGES into the stored blob rather than replacing it — the property
 * rows only know the keys for the node's own type, and a replace would silently
 * drop everything else on the node (event form_schema, importer provenance…).
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const { nodeId } = await context.params;
  const body = await request.json().catch(() => ({}));
  const { spaceId } = body as { spaceId?: string };
  if (!spaceId) {
    return NextResponse.json({ error: 'spaceId is required' }, { status: 400 });
  }

  const columnKeys = Object.keys(PATCHABLE_COLUMNS).filter((k) => k in body);
  const hasTags = 'tags' in body;
  const hasMetadata = 'metadata' in body && body.metadata !== null && typeof body.metadata === 'object';
  const hasName = 'name' in body;
  const name = hasName && typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME_LEN) : null;
  if (hasName && !name) {
    return NextResponse.json({ error: 'name must be a non-empty string' }, { status: 400 });
  }
  if (!hasTags && !hasMetadata && !hasName && columnKeys.length === 0) {
    return NextResponse.json(
      { error: 'One of name, tags, metadata, or a property column is required' },
      { status: 400 },
    );
  }
  const tags = hasTags ? cleanTags(body.tags) : null;

  const node = await prisma.node.findUnique({
    where: { id: nodeId },
    select: { spaceId: true, metadata: true, type: true, identityId: true },
  });
  if (!node) return NextResponse.json({ error: 'Node not found' }, { status: 404 });

  // The note (and thus its tags) live in the node's own space context; a
  // mismatched space would edit a misbound entity.
  if (node.spaceId !== spaceId) {
    return NextResponse.json({ error: 'Node not found' }, { status: 404 });
  }
  // Active membership (or admin) of the node's own space is the write gate.
  if (await spaceMemberForbidden(session.userId, spaceId, session.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  // A global record's fields are gathered, not typed (lib/global/record.ts);
  // a follower's are pushed from the record. Neither takes a local edit.
  if (isGlobalSpace(spaceId) && !isSuperAdmin(session.email)) {
    return NextResponse.json(
      { error: 'Visvine records are built from public spaces and profiles. Edit your profile to change yours.' },
      { status: 403 },
    );
  }
  if (((node.metadata as Record<string, unknown> | null) ?? {})[GLOBAL_MODE_KEY] === 'follow') {
    return NextResponse.json(
      { error: 'This context follows its Visvine record — detach it to edit here.' },
      { status: 409 },
    );
  }

  const data: Record<string, unknown> = {};
  if (name !== null) data.name = name;
  if (tags !== null) data.tags = tags;
  for (const key of columnKeys) {
    const column = PATCHABLE_COLUMNS[key as keyof typeof PATCHABLE_COLUMNS];
    const value = body[key];
    // An empty string means "clear this row", which is a null column — storing
    // '' would make a blank field read as a real (empty) value downstream.
    data[column] = typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  }
  if (hasMetadata) {
    const patch = { ...(body.metadata as Record<string, unknown>) };
    for (const key of RESERVED_METADATA_KEYS) delete patch[key];
    data.metadata = {
      ...((node.metadata as Record<string, unknown>) ?? {}),
      ...patch,
    };
  }

  // Update the context node. NOTHING is mirrored onto the Person row.
  //
  // This used to copy `tags` and `imageUrl` across, so that a person card edited
  // in one space's directory rewrote that member's GLOBAL profile — their photo
  // and their skills — everywhere, for everyone. The gate on this route is
  // active membership of the node's own space, so any member of any space you
  // belonged to could change your profile picture. That is not a doctrine
  // violation so much as an authorization hole, and the mirror was the hole.
  //
  // The two are different things and now say so: a `Person` is the member's own
  // cross-space profile, edited only by them at PATCH /api/profile/[personId],
  // and a person NODE is one space's card for them, collaborative like every
  // other node in that space's directory. The profile page reads Person; this
  // route writes the node. Neither reaches across.
  const updated = await prisma.node.update({
    where: { id: nodeId },
    data,
    select: { id: true, type: true, spaceId: true, name: true, location: true, metadata: true },
  });

  // The note's frontmatter follows the record — a rename, or an event's date
  // and venue from the property rows — while its body stays whatever was written.
  if (updated.spaceId) {
    await syncEntityNoteFrontmatter(
      {
        ...updated,
        spaceId: updated.spaceId,
        metadata: (updated.metadata as Record<string, unknown> | null) ?? null,
      },
      { id: session.userId, name: session.name, email: session.email ?? null },
    );
  }

  // A public card changed: its record may have too.
  await syncGlobalRecordSafe(node.identityId);
  revalidateTag('context-data-v2', { expire: 0 });
  return NextResponse.json({ name: name ?? undefined, tags: tags ?? undefined, ok: true });
}
