/**
 * Node profile API — returns full node data with connection + space counts
 * GET /api/nodes/[nodeId]
 */

import { NextRequest, NextResponse } from 'next/server';
import { entityLensFor } from '@/lib/notes/context/entityVisibility';
import { isEntityHidden } from '@/lib/notes/shared/entityVisibility';
import { revalidateTag } from 'next/cache';
import prisma from '@/lib/prisma';
import { spaceMemberForbidden } from '@/lib/auth';
import { isSuperAdmin } from '@/lib/session';
import { isGlobalSpace } from '@/lib/spaces/globalSpace';
import { GLOBAL_MODE_KEY, syncGlobalRecordSafe } from '@/lib/global/record';
import { requireApiSession } from '@/lib/api/route';
import { syncEntityNoteFrontmatter } from '@/lib/notes/context/entityNodes';
import { samePersonRecords } from '@/lib/directory/samePerson';
import { planMetadataWrite, writableColumns } from '@/lib/directory/fieldWrite';
import { findNodeTypeConfig } from '@/lib/types/context';
import { canonicalType } from '@/lib/types/typeFields';
import { entityNotePath } from '@/lib/notes/entities';
import { principalOf, resolveContext } from '@/lib/notes/resolve';
import { writeDenialFull } from '@/lib/notes/contextService';
import { isEventManager, EVENT_MANAGER_DENIAL } from '@/lib/eventAuth';
import type { NBEvent } from '@/lib/types';
import type { NodeTypeConfig } from '@/lib/types';

const MAX_NAME_LEN = 120;

type RouteContext = {
  params: Promise<{ nodeId: string }>;
};

/** The most connections one profile read returns; the count is still exact. */
const MAX_CONNECTIONS = 500;
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

export async function GET(_request: NextRequest, context: RouteContext) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const { nodeId } = await context.params;

  const node = await prisma.node.findUnique({
    where: { id: nodeId },
    select: { id: true, type: true, name: true, subtitle: true, location: true, url: true, imageUrl: true, tags: true, metadata: true, alias: true, spaceId: true, createdAt: true, identityId: true, identity: { select: { userId: true } } },
  });

  if (!node) {
    return NextResponse.json({ error: 'Node not found' }, { status: 404 });
  }

  // The node's profile + full connection graph are space-scoped confidential
  // data: only an active member (or admin) of its space may read them. A
  // personal space is likewise private to its owner. Anyone else gets a 404 so
  // the endpoint reveals nothing — not even that the node exists. The gate
  // runs before the graph is read, so a refused caller costs one row.
  if (node.spaceId && (await spaceMemberForbidden(session.userId, node.spaceId, session.email))) {
    return NextResponse.json({ error: 'Node not found' }, { status: 404 });
  }
  // A file shared only where this viewer is not, a private channel they are
  // not in: the node is as private as its note.
  if (node.spaceId) {
    const lens = await entityLensFor(node.spaceId, session.userId, session.email);
    if (lens && isEntityHidden({ ...node, metadata: (node.metadata ?? {}) as Record<string, unknown> }, lens)) {
      return NextResponse.json({ error: 'Node not found' }, { status: 404 });
    }
  }

  // Links + connected node data in one shot, bounded: a hub's page shows its
  // first MAX_CONNECTIONS with the true total beside them.
  // The same person elsewhere in the family, for the spaces this viewer can
  // open: the one join across records, drawn on the page and never as a row.
  const [linksWithNodes, connectionCount, samePerson] = await Promise.all([
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
      LIMIT ${MAX_CONNECTIONS}
    `,
    prisma.link.count({ where: { OR: [{ sourceId: nodeId }, { targetId: nodeId }] } }),
    node.spaceId ? samePersonRecords({ id: node.id, spaceId: node.spaceId, identityId: node.identityId }, session.userId) : Promise.resolve([]),
  ]);

  // The member this node is connected to: the identity link is canonical; a
  // member's own node (User.nodeId) counts before the personal space has
  // connected it.
  let connectedUserId: string | null = node.identity?.userId ?? null;

  // Real shared-space count: spaces where both the viewer and the
  // profile's linked user are active members. Nodes without a linked user
  // exist in exactly their own space.
  let spaceCount = 1;
  if (nodeId.startsWith('person:')) {
    const person = connectedUserId
      ? { userId: connectedUserId }
      : await prisma.user.findUnique({ where: { nodeId }, select: { id: true } }).then((u) => (u ? { userId: u.id } : null));
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
        ...(node.identityId ? { identity_id: node.identityId } : {}),
        ...(samePerson.length > 0 ? { same_person: samePerson } : {}),
        createdAt: node.createdAt.toISOString(),
      },
      connectionCount,
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
 * display name from its context note or a Directory cell. Body: { spaceId,
 * name?, tags?, metadata?, subtitle?, location?, url?, image_url? }.
 *
 * This is the record's FIELD door, so it writes fields and nothing else
 * (lib/directory/fieldWrite.ts): `metadata` keys must be fields the node's
 * type declares — its property rows and the space's tracked fields — each
 * parsed on the server, and a column only one the type has. The keys the
 * platform keeps in metadata (an event's hosts, audience and draft flag, a
 * note pointer, an identity binding) are refused by name: each has its own
 * door with its own gate.
 *
 * Who: an active member of the node's space who can see the record (the
 * Directory's rule) and may write its note (the context write gate). An
 * event's fields are its managers' (`isEventManager`), as on its edit page;
 * its tags stay the space's.
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
  const hasMetadata = 'metadata' in body && body.metadata !== null && typeof body.metadata === 'object' && !Array.isArray(body.metadata);
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
    select: { id: true, spaceId: true, metadata: true, type: true, identityId: true, name: true, alias: true },
  });
  if (!node) return NextResponse.json({ error: 'Node not found' }, { status: 404 });

  // The note (and thus its tags) live in the node's own space context; a
  // mismatched space would edit a misbound entity.
  if (node.spaceId !== spaceId) {
    return NextResponse.json({ error: 'Node not found' }, { status: 404 });
  }
  // Active membership (or admin) of the node's own space is the first gate.
  if (await spaceMemberForbidden(session.userId, spaceId, session.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const metadataNow = (node.metadata as Record<string, unknown> | null) ?? {};
  // A record the viewer cannot see reads as absent, exactly as GET answers.
  const lens = await entityLensFor(spaceId, session.userId, session.email);
  if (lens && isEntityHidden({ ...node, metadata: metadataNow }, lens)) {
    return NextResponse.json({ error: 'Node not found' }, { status: 404 });
  }
  // A global record's fields are gathered, not typed (lib/global/record.ts);
  // a follower's are pushed from the record. Neither takes a local edit.
  if (isGlobalSpace(spaceId) && !isSuperAdmin(session.email)) {
    return NextResponse.json(
      { error: 'Visvine records are built from public spaces and profiles. Edit your profile to change yours.' },
      { status: 403 },
    );
  }
  if (metadataNow[GLOBAL_MODE_KEY] === 'follow') {
    return NextResponse.json(
      { error: 'This context follows its Visvine record — detach it to edit here.' },
      { status: 409 },
    );
  }

  // The record is its note: whoever may not write the note may not change it.
  const notePath = entityNotePath({ ...node, metadata: metadataNow });
  if (notePath) {
    const resolved = await resolveContext(session, spaceId);
    if (resolved instanceof Response) return resolved;
    const denial = await writeDenialFull(await principalOf(resolved), resolved, notePath);
    if (denial) return NextResponse.json({ error: denial }, { status: 403 });
  }

  // An event's name, date, place and the rest are its managers' to change.
  const touchesFields = hasName || hasMetadata || columnKeys.length > 0;
  if (touchesFields && canonicalType(node.type) === 'event') {
    const hosts = Array.isArray(metadataNow.hosts) ? (metadataNow.hosts as string[]) : [];
    if (!(await isEventManager(session, spaceId, { hosts } as unknown as NBEvent))) {
      return NextResponse.json({ error: EVENT_MANAGER_DENIAL }, { status: 403 });
    }
  }

  const columns = writableColumns(node.type);
  for (const key of columnKeys) {
    if (!columns.has(key)) {
      return NextResponse.json({ error: `"${key}" is not a field of ${node.type}` }, { status: 400 });
    }
  }

  let metadataPatch: Record<string, unknown> | null = null;
  if (hasMetadata) {
    const space = await prisma.space.findUnique({ where: { id: spaceId }, select: { nodeTypes: true } });
    const config = findNodeTypeConfig(node.type, (space?.nodeTypes ?? []) as unknown as NodeTypeConfig[]);
    const plan = planMetadataWrite(node.type, config, body.metadata as Record<string, unknown>);
    if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: 400 });
    metadataPatch = plan.metadata;
  }

  const data: Record<string, unknown> = {};
  if (name !== null) data.name = name;
  if (tags !== null) data.tags = tags;
  for (const key of columnKeys) {
    const column = PATCHABLE_COLUMNS[key as keyof typeof PATCHABLE_COLUMNS];
    const value = body[key];
    // An empty string means "clear this row", which is a null column — storing
    // '' would make a blank field read as a real (empty) value downstream.
    data[column] = typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, 2000) : null;
  }
  if (metadataPatch) {
    data.metadata = { ...metadataNow, ...metadataPatch };
  }

  // The node is one space's card for the entity; nothing here writes the
  // member's own cross-space profile, which only they edit
  // (PATCH /api/profile/<id>).
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
