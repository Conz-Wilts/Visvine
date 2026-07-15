import { NextResponse } from 'next/server';
import { isSuperAdmin } from '@/lib/session';
import { requireApiSession } from '@/lib/api/route';
import prisma from '@/lib/prisma';

/**
 * GET: Return all communities the current user has joined
 */
export async function GET() {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const superAdmin = isSuperAdmin(session.email);

  const memberships = await prisma.userCommunity.findMany({
    where: { userId: session.userId },
    select: {
      role: true,
      joinedAt: true,
      community: {
        select: {
          id: true,
          name: true,
          description: true,
          country: true,
          location: true,
          tags: true,
          memberCount: true,
          createdAt: true,
          imageUrl: true,
          nodeTypes: true,
          communityAliases: true,
          linkTypes: true,
          designConfig: true,
        },
      },
    },
    orderBy: { joinedAt: 'asc' },
  });

  const communities = memberships.map(m => ({
    id: m.community.id,
    name: m.community.name,
    description: m.community.description,
    country: m.community.country,
    location: m.community.location,
    tags: m.community.tags,
    memberCount: m.community.memberCount,
    dataFile: '',
    createdAt: m.community.createdAt.toISOString(),
    imageUrl: m.community.imageUrl,
    nodeTypes: m.community.nodeTypes,
    communityAliases: m.community.communityAliases,
    linkTypes: m.community.linkTypes,
    designConfig: m.community.designConfig,
    role: superAdmin ? 'admin' : m.role,
    joinedAt: m.joinedAt.toISOString(),
  }));

  return NextResponse.json({ communities, isSuperAdmin: superAdmin });
}
