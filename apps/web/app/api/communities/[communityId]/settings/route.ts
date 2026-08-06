import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getAdminSession as requireAdmin } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { sanitizeFeatureConfig } from '@/lib/featureAccess';

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
  const { name, description, country, location, tags, designConfig, featureConfig, visibility } = body as {
    name?: string;
    description?: string;
    country?: string | null;
    location?: string;
    tags?: string[];
    designConfig?: Record<string, unknown>;
    featureConfig?: { enabled?: Record<string, boolean>; directoryPrivate?: boolean; adminOnly?: string[]; order?: string[]; more?: string[] };
    visibility?: string;
  };

  if (name !== undefined && !name.trim()) {
    return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
  }

  if (country !== undefined && country !== null && typeof country !== 'string') {
    return NextResponse.json({ error: 'country must be a string' }, { status: 400 });
  }

  if (visibility !== undefined && visibility !== 'public' && visibility !== 'private') {
    return NextResponse.json({ error: 'visibility must be public or private' }, { status: 400 });
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

  // Validate featureConfig if provided — must be
  // { enabled?: { [key]: boolean }, directoryPrivate?: boolean, adminOnly?: string[],
  //   order?: string[], more?: string[] }
  if (featureConfig !== undefined) {
    const enabled = featureConfig.enabled;
    if (enabled !== undefined && (typeof enabled !== 'object' || enabled === null || Array.isArray(enabled))) {
      return NextResponse.json({ error: 'featureConfig.enabled must be an object' }, { status: 400 });
    }
    if (enabled && Object.values(enabled).some((v) => typeof v !== 'boolean')) {
      return NextResponse.json({ error: 'featureConfig.enabled values must be booleans' }, { status: 400 });
    }
    if (featureConfig.directoryPrivate !== undefined && typeof featureConfig.directoryPrivate !== 'boolean') {
      return NextResponse.json({ error: 'featureConfig.directoryPrivate must be a boolean' }, { status: 400 });
    }
    const adminOnly = featureConfig.adminOnly;
    if (adminOnly !== undefined && !Array.isArray(adminOnly)) {
      return NextResponse.json({ error: 'featureConfig.adminOnly must be an array' }, { status: 400 });
    }
    if (adminOnly && adminOnly.some((v) => typeof v !== 'string')) {
      return NextResponse.json({ error: 'featureConfig.adminOnly values must be strings' }, { status: 400 });
    }
    const order = featureConfig.order;
    if (order !== undefined && !Array.isArray(order)) {
      return NextResponse.json({ error: 'featureConfig.order must be an array' }, { status: 400 });
    }
    if (order && order.some((v) => typeof v !== 'string')) {
      return NextResponse.json({ error: 'featureConfig.order values must be strings' }, { status: 400 });
    }
    const more = featureConfig.more;
    if (more !== undefined && !Array.isArray(more)) {
      return NextResponse.json({ error: 'featureConfig.more must be an array' }, { status: 400 });
    }
    if (more && more.some((v) => typeof v !== 'string')) {
      return NextResponse.json({ error: 'featureConfig.more values must be strings' }, { status: 400 });
    }
  }

  // The tag-colour registry lives in designConfig but is written by members via
  // the tag-colors route; preserve it when a design-settings save omits it so an
  // admin saving the design panel can't wipe every tag's colour.
  let designConfigToWrite = designConfig;
  if (designConfig !== undefined && (designConfig as Record<string, unknown>).tagColors === undefined) {
    const existing = await prisma.community.findUnique({
      where: { id: communityId },
      select: { designConfig: true },
    });
    const existingTagColors = (existing?.designConfig as Record<string, unknown> | null)?.tagColors;
    if (existingTagColors !== undefined) {
      designConfigToWrite = { ...(designConfig as Record<string, unknown>), tagColors: existingTagColors };
    }
  }

  const updated = await prisma.community.update({
    where: { id: communityId },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(description !== undefined && { description }),
      ...(country !== undefined && { country: country || null }),
      ...(location !== undefined && { location: location || null }),
      ...(tags !== undefined && { tags }),
      ...(designConfig !== undefined && { designConfig: designConfigToWrite as object }),
      ...(featureConfig !== undefined && { featureConfig: sanitizeFeatureConfig(featureConfig) as object }),
      ...(visibility !== undefined && { visibility }),
    },
  });

  revalidateTag('context-data-v2', { expire: 0 });

  return NextResponse.json({
    community: {
      id: updated.id,
      name: updated.name,
      description: updated.description,
      country: updated.country,
      location: updated.location,
      tags: updated.tags,
      designConfig: updated.designConfig,
      featureConfig: updated.featureConfig,
      visibility: updated.visibility,
    },
  });
}
