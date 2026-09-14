import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getAdminSession as requireAdmin } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { mergeFeatureConfig } from '@/lib/featureAccess';
import type { SpaceDesignConfig } from '@/lib/types';
import {
  effectiveNameAndVisibility,
  findPublicNameConflict,
  publicNameTakenMessage,
} from '@/lib/spaces/publicName';
import { updateSpaceConfig, UnknownSpaceError } from '@/lib/spaces/spaceConfig';
import { DIAL_SELECT, ensureFlowUpGrant, findSiblingNameConflict } from '@/lib/spaces/subspaceAccess';
import { adminSpaceIds } from '@/lib/auth';
import {
  DOORS,
  LISTINGS,
  flowsContext,
  listingOf,
  subspaceConfigOf,
  visibilityForListing,
  type Door,
  type Listing,
} from '@/lib/spaces/subspaces';
import { mergeDesignConfig } from '@/lib/spaces/configMerge';

/**
 * PUT: Update space settings (admin only)
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  const { spaceId } = await params;

  const session = await requireAdmin(spaceId);
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  // `timezone` is deliberately not read: a scheduled agent names its own zone
  // in its own brief, so there is no space-wide default to set here.
  const {
    name, description, country, location, tags, designConfig, featureConfig,
    listing, houseDoor, worldDoor, flowContext, flowEvents, flowPeople, parentAdmins, subspaceConfig,
  } = body as {
    name?: string;
    description?: string;
    country?: string | null;
    location?: string;
    tags?: string[];
    designConfig?: Record<string, unknown>;
    featureConfig?: { enabled?: Record<string, boolean>; directoryPrivate?: boolean; adminOnly?: string[]; order?: string[]; more?: string[] };
    visibility?: string;
    listing?: string;
    houseDoor?: string;
    worldDoor?: string;
    flowContext?: boolean;
    flowEvents?: boolean;
    flowPeople?: boolean;
    parentAdmins?: boolean;
    subspaceConfig?: { modelKeys?: unknown };
  };
  // `visibility` is what a top-level space sets; a room sets `listing`, which
  // decides its visibility (world ⇔ public). Either spelling is accepted and
  // both are resolved to one pair below.
  let visibility = (body as { visibility?: string }).visibility;

  if (name !== undefined && !name.trim()) {
    return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
  }

  if (country !== undefined && country !== null && typeof country !== 'string') {
    return NextResponse.json({ error: 'country must be a string' }, { status: 400 });
  }

  if (visibility !== undefined && visibility !== 'public' && visibility !== 'private') {
    return NextResponse.json({ error: 'visibility must be public or private' }, { status: 400 });
  }
  if (listing !== undefined && !LISTINGS.includes(listing as Listing)) {
    return NextResponse.json({ error: 'listing must be secret, house or world' }, { status: 400 });
  }
  for (const [key, value] of [['houseDoor', houseDoor], ['worldDoor', worldDoor]] as const) {
    if (value !== undefined && !DOORS.includes(value as Door)) {
      return NextResponse.json({ error: `${key} must be invite, ask or open` }, { status: 400 });
    }
  }
  for (const [key, value] of [['flowContext', flowContext], ['flowEvents', flowEvents], ['flowPeople', flowPeople], ['parentAdmins', parentAdmins]] as const) {
    if (value !== undefined && typeof value !== 'boolean') {
      return NextResponse.json({ error: `${key} must be a boolean` }, { status: 400 });
    }
  }

  // The room's dials (docs/sub-spaces.md) are about the house it sits in, so
  // a top-level space has none of them; the house's `subspaceConfig` is the
  // one thing only a top-level space has.
  const dialPatch = listing !== undefined || houseDoor !== undefined || worldDoor !== undefined
    || flowContext !== undefined || flowEvents !== undefined || flowPeople !== undefined || parentAdmins !== undefined;
  let stored: (Record<string, unknown> & { parentId: string | null; parentAdmins: boolean }) | null = null;
  if (dialPatch || subspaceConfig !== undefined) {
    stored = await prisma.space.findUnique({ where: { id: spaceId }, select: DIAL_SELECT });
    if (!stored) return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    if (dialPatch && !stored.parentId) {
      return NextResponse.json({ error: 'Only a sub-space has a listing, doors, flows or parent admins' }, { status: 400 });
    }
    if (subspaceConfig !== undefined && stored.parentId) {
      return NextResponse.json({ error: 'Only a top-level space shares model keys or hides rooms from its band' }, { status: 400 });
    }
    // Governance: any admin of the room may hand the keys back (switch it
    // off); only a holder of the room's OWN admin alias may switch it on. A
    // house admin whose standing comes through this very switch cannot
    // reclaim what the room gave back.
    if (parentAdmins === true && !stored.parentAdmins) {
      const direct = await adminSpaceIds(session.userId, [spaceId], session.email);
      if (!direct.has(spaceId)) {
        return NextResponse.json(
          { error: 'Only an admin of this space itself can let the parent’s admins manage it again.' },
          { status: 403 },
        );
      }
    }
    if (listing !== undefined) visibility = visibilityForListing(listing as Listing);
  }
  const subspaceConfigPatch = subspaceConfig !== undefined ? subspaceConfigOf(subspaceConfig) : undefined;

  // Public space names must be unique (lib/spaces/publicName.ts). Both the
  // rename and the private→public toggle come through here, and each arrives as
  // its own single-field patch, so the check is against the pair the space will
  // END UP with — a name-only patch conflicts when the space is already public,
  // a visibility-only patch conflicts when its existing name is taken.
  if (name !== undefined || visibility !== undefined) {
    const current = await prisma.space.findUnique({
      where: { id: spaceId },
      select: { name: true, visibility: true, personalOwnerId: true, parentId: true },
    });
    if (!current) {
      return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    }
    const effective = effectiveNameAndVisibility({ name, visibility }, current);
    // A sub-space's name is unique among its siblings, public or not
    // (lib/spaces/subspaceAccess.ts) — the same key as the public-name rule.
    if (name !== undefined && current.parentId) {
      const sibling = await findSiblingNameConflict(current.parentId, effective.name, spaceId);
      if (sibling) {
        return NextResponse.json({ error: sibling.message, code: 'name_taken' }, { status: 409 });
      }
    }
    if (effective.isPublic && !current.personalOwnerId) {
      const clash = await findPublicNameConflict(effective.name, spaceId);
      if (clash) {
        return NextResponse.json(
          { error: publicNameTakenMessage(clash.name), code: 'name_taken' },
          { status: 409 }
        );
      }
    }
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

  // Both JSON columns here are shared with writers this route can't see — the
  // tag-colour registry inside designConfig belongs to any member through the
  // tag-colors route, and featureConfig is split across two console panels. So
  // the merge happens against what is stored, under the space lock, rather than
  // against a snapshot the client read minutes ago.
  let updated: Awaited<ReturnType<typeof updateSpaceConfig>>['space'];
  try {
    const result = await updateSpaceConfig(
      spaceId,
      (stored) => ({
        ...(designConfig !== undefined && {
          designConfig: mergeDesignConfig(stored.designConfig, designConfig as SpaceDesignConfig),
        }),
        // `directoryPrivate` is re-derived when the patch carries `adminOnly`
        // and inherited untouched when it doesn't — see mergeFeatureConfig.
        ...(featureConfig !== undefined && {
          featureConfig: mergeFeatureConfig(stored.featureConfig, featureConfig),
        }),
      }),
      {
        also: {
          ...(name !== undefined && { name: name.trim() }),
          ...(description !== undefined && { description }),
          ...(country !== undefined && { country: country || null }),
          ...(location !== undefined && { location: location || null }),
          ...(tags !== undefined && { tags }),
          ...(visibility !== undefined && { visibility }),
          ...(listing !== undefined && { listing }),
          ...(houseDoor !== undefined && { houseDoor }),
          ...(worldDoor !== undefined && { worldDoor }),
          ...(flowContext !== undefined && { flowContext }),
          ...(flowEvents !== undefined && { flowEvents }),
          ...(flowPeople !== undefined && { flowPeople }),
          ...(parentAdmins !== undefined && { parentAdmins }),
          ...(subspaceConfigPatch !== undefined && { subspaceConfig: subspaceConfigPatch as object }),
        },
        skipRevalidate: true,
      },
    );
    updated = result.space;
  } catch (err) {
    if (err instanceof UnknownSpaceError) {
      return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    }
    throw err;
  }

  // A room whose context flows up flows nothing without the root grant it is
  // read under. Born flowing, a room gets it in provisionSpace; one that
  // starts flowing later would otherwise appear in its parent as an empty
  // folder.
  if (updated.parentId && flowsContext(updated)) {
    await ensureFlowUpGrant(spaceId, session.userId);
  }

  revalidateTag('context-data-v2', { expire: 0 });

  return NextResponse.json({
    space: {
      id: updated.id,
      name: updated.name,
      description: updated.description,
      country: updated.country,
      location: updated.location,
      tags: updated.tags,
      designConfig: updated.designConfig,
      featureConfig: updated.featureConfig,
      visibility: updated.visibility,
      listing: listingOf(updated),
      houseDoor: updated.houseDoor,
      worldDoor: updated.worldDoor,
      flowContext: updated.flowContext,
      flowEvents: updated.flowEvents,
      flowPeople: updated.flowPeople,
      parentAdmins: updated.parentAdmins,
      subspaceConfig: subspaceConfigOf(updated.subspaceConfig),
      timezone: updated.timezone,
    },
  });
}
