import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSession, isSuperAdmin } from '@/lib/session';
import prisma from '@/lib/prisma';
import { logActivity } from '@/lib/activityLog';

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
 * PUT: Update community settings (admin only)
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ communityId: string }> }
) {
  const { communityId } = await params;

  const session = await requireAdmin(communityId);
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { name, description, location, tags, designConfig } = body as {
    name?: string;
    description?: string;
    location?: string;
    tags?: string[];
    designConfig?: Record<string, unknown>;
  };

  if (name !== undefined && !name.trim()) {
    return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
  }

  // Validate designConfig if provided
  if (designConfig !== undefined) {
    const bg = designConfig.background as Record<string, unknown> | undefined;
    if (bg) {
      if (bg.type !== 'solid' && bg.type !== 'image') {
        return NextResponse.json({ error: 'background.type must be solid or image' }, { status: 400 });
      }
      if (bg.type === 'solid' && bg.color && !/^#[0-9a-fA-F]{6}$/.test(bg.color as string)) {
        return NextResponse.json({ error: 'background.color must be a valid hex color' }, { status: 400 });
      }
    }
  }

  const updated = await prisma.community.update({
    where: { id: communityId },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(description !== undefined && { description }),
      ...(location !== undefined && { location: location || null }),
      ...(tags !== undefined && { tags }),
      ...(designConfig !== undefined && { designConfig: designConfig as object }),
    },
  });

  revalidateTag('graph-data-v2');

  await logActivity({
    communityId,
    actorEmail: session.email,
    actorName: session.name,
    action: 'settings_updated',
    details: { fields: Object.keys(body).filter(k => body[k as keyof typeof body] !== undefined) },
  });

  return NextResponse.json({
    community: {
      id: updated.id,
      name: updated.name,
      description: updated.description,
      location: updated.location,
      tags: updated.tags,
      designConfig: updated.designConfig,
    },
  });
}
