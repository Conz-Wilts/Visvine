import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSession, isSuperAdmin } from '@/lib/session';
import prisma from '@/lib/prisma';
import type { NBNode } from '@/lib/types';
import { normalizeImageUrl } from '@/lib/mediaUrl';

export type AdminProfileNode = NBNode & {
  isMember: boolean;
  isActiveUser: boolean;
  userId?: string;
};

async function requireAdmin(communityId: string) {
  const session = await getSession();
  if (!session) return null;
  if (isSuperAdmin(session.email)) return session;
  const membership = await prisma.userCommunity.findUnique({
    where: { userId_communityId: { userId: session.userId, communityId } },
    select: { role: true },
  });
  if (membership?.role !== 'admin') return null;
  return session;
}

/**
 * GET: List all nodes for a community with member status info (admin only)
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ communityId: string }> }
) {
  const { communityId } = await params;

  const session = await requireAdmin(communityId);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const nodeRows = await prisma.node.findMany({
    where: { communityId },
    select: { id: true, type: true, name: true, alias: true, subtitle: true, location: true, url: true, imageUrl: true, tags: true, metadata: true, communityId: true },
    orderBy: { name: 'asc' },
  });

  // Resolve member status for person: nodes
  const personIds = nodeRows.filter(n => n.id.startsWith('person:')).map(n => n.id);
  const memberStatusMap = new Map<string, { isMember: boolean; isActiveUser: boolean; userId?: string }>();

  if (personIds.length > 0) {
    const persons = await prisma.person.findMany({
      where: { id: { in: personIds } },
      select: {
        id: true,
        userId: true,
        user: {
          select: {
            isActive: true,
            userCommunities: {
              where: { communityId },
              select: { id: true },
            },
          },
        },
      },
    });

    for (const p of persons) {
      const isActiveUser = !!p.user?.isActive;
      const isMember = isActiveUser && (p.user?.userCommunities.length ?? 0) > 0;
      memberStatusMap.set(p.id, {
        isMember,
        isActiveUser,
        userId: p.userId ?? undefined,
      });
    }
  }

  const nodes: AdminProfileNode[] = nodeRows.map(row => {
    const status = memberStatusMap.get(row.id) ?? { isMember: false, isActiveUser: false };
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
      community_id: row.communityId ?? undefined,
      isMember: status.isMember,
      isActiveUser: status.isActiveUser,
      userId: status.userId,
    };
  });

  return NextResponse.json({ nodes });
}

const EDITABLE_FIELDS = ['name', 'subtitle', 'location', 'url', 'tags', 'imageUrl', 'alias'] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];

// Person-model fields editable by admin for non-member person nodes
const PERSON_EDITABLE_FIELDS = [
  'bio', 'website', 'linkedinUrl', 'twitterUrl', 'phone', 'pronouns', 'openToWork',
] as const;

/**
 * PATCH: Update a non-member node's fields (admin only)
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ communityId: string }> }
) {
  const { communityId } = await params;

  const session = await requireAdmin(communityId);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { nodeId, fields } = body as { nodeId: string; fields: Record<string, unknown> };

  if (!nodeId || typeof nodeId !== 'string') {
    return NextResponse.json({ error: 'nodeId required' }, { status: 400 });
  }

  // Reject type edits
  if ('type' in fields) {
    return NextResponse.json({ error: 'type field cannot be modified' }, { status: 400 });
  }

  // Verify node belongs to this community
  const node = await prisma.node.findFirst({
    where: { id: nodeId, communityId },
    select: { id: true },
  });
  if (!node) return NextResponse.json({ error: 'Node not found' }, { status: 404 });

  // Verify not a member node
  if (nodeId.startsWith('person:')) {
    const person = await prisma.person.findUnique({
      where: { id: nodeId },
      select: {
        userId: true,
        user: {
          select: {
            isActive: true,
            userCommunities: { where: { communityId }, select: { id: true } },
          },
        },
      },
    });
    const isMember = !!person?.user?.isActive && (person.user.userCommunities.length ?? 0) > 0;
    if (isMember) {
      return NextResponse.json({ error: 'Cannot edit member profile' }, { status: 403 });
    }
  }

  // Build safe update payload
  const data: Partial<{
    name: string;
    subtitle: string | null;
    location: string | null;
    url: string | null;
    tags: string[];
    imageUrl: string | null;
    alias: string | null;
  }> = {};

  for (const key of EDITABLE_FIELDS) {
    if (key in fields) {
      const val = fields[key];
      if (key === 'tags') {
        data.tags = Array.isArray(val) ? (val as string[]) : [];
      } else if (key === 'name') {
        if (typeof val === 'string' && val.trim()) data.name = val.trim();
      } else {
        (data as Record<EditableField, unknown>)[key] = val === '' ? null : (val as string | null);
      }
    }
  }

  // Build Person-model update payload (only for person: nodes)
  const personData: Record<string, unknown> = {};
  if (nodeId.startsWith('person:')) {
    for (const key of PERSON_EDITABLE_FIELDS) {
      if (key in fields) {
        const val = fields[key];
        if (key === 'openToWork') {
          personData.openToWork = !!val;
        } else {
          personData[key] = val === '' ? null : (val as string | null);
        }
      }
    }
  }

  if (Object.keys(data).length === 0 && Object.keys(personData).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  let updated;
  if (Object.keys(data).length > 0) {
    updated = await prisma.node.update({
      where: { id: nodeId },
      data,
      select: { id: true, name: true, subtitle: true, location: true, url: true, imageUrl: true, tags: true, alias: true },
    });
  } else {
    updated = await prisma.node.findUnique({
      where: { id: nodeId },
      select: { id: true, name: true, subtitle: true, location: true, url: true, imageUrl: true, tags: true, alias: true },
    });
  }

  // Keep Person.imageUrl in sync when a person node's image changes
  if (nodeId.startsWith('person:') && 'imageUrl' in data) {
    personData.imageUrl = data.imageUrl ?? null;
  }

  // Update Person model if there are person-specific fields
  let personUpdated: Record<string, unknown> | null = null;
  if (Object.keys(personData).length > 0) {
    personUpdated = await prisma.person.upsert({
      where: { id: nodeId },
      update: personData,
      create: { id: nodeId, name: updated?.name ?? '', ...personData },
      select: { bio: true, website: true, linkedinUrl: true, twitterUrl: true, phone: true, pronouns: true, openToWork: true, imageUrl: true },
    });
  }

  revalidateTag('graph-data-v2');

  return NextResponse.json({ node: updated, person: personUpdated });
}
