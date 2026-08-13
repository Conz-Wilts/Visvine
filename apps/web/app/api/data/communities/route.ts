import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import prisma from '@/lib/prisma';
import { requireSession, isSuperAdmin } from '@/lib/session';
import { isAdmin } from '@/lib/auth';
import { mergeNodeTypeList, type Space, type SpaceAlias, type NodeTypeConfig } from '@/lib/types';
import { handleApiError } from '@/lib/api/route';
import { listVisibleSpaces } from '@/lib/spaces/queries';
import {
  effectiveNameAndVisibility,
  findPublicNameConflict,
  publicNameTakenMessage,
} from '@/lib/spaces/publicName';
import { ALL_FEATURE_KEYS, CORE_FEATURE_KEYS } from '@/lib/featureAccess';
import { reconcilePersonAliases } from '@/lib/notes/aliases';
import { ensureRootIndex, SHARED_OWNER_KEY } from '@/lib/notes/store';
import { logger } from '@/lib/logger';

/**
 * GET: Fetch all spaces
 */
export async function GET() {
  try {
    const session = await requireSession();
    if (session instanceof Response) return session;

    const spaces = await listVisibleSpaces(session);

    return NextResponse.json(
      { spaces },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          'Pragma': 'no-cache',
        },
      }
    );
  } catch (err) {
    return handleApiError(err, 'api.data.spaces.get.failed');
  }
}

/**
 * POST: Create a new space
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    if (session instanceof Response) return session;
    if (!isSuperAdmin(session.email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { space } = body as { space: Partial<Space> };

    if (!space.id || !space.name) {
      return NextResponse.json(
        { error: 'Space must have id and name' },
        { status: 400 }
      );
    }

    // Same rule as the user-facing create: a public name must be free
    // (lib/spaces/publicName.ts). Private bulk creates are unconstrained.
    if (space.visibility === 'public') {
      const clash = await findPublicNameConflict(space.name);
      if (clash) {
        return NextResponse.json(
          { error: publicNameTakenMessage(clash.name), code: 'name_taken' },
          { status: 409 }
        );
      }
    }

    const created = await prisma.space.create({
      data: {
        id: space.id,
        name: space.name,
        description: space.description || '',
        location: space.location ?? null,
        tags: space.tags || [],
        imageUrl: space.imageUrl ?? null,
        nodeTypes: space.nodeTypes as object ?? null,
        aliases: space.aliases as object ?? [],
        // Same defaults as the user-facing create: private, Directory only.
        visibility: space.visibility === 'public' ? 'public' : 'private',
        featureConfig: {
          enabled: Object.fromEntries(
            ALL_FEATURE_KEYS.filter((key) => !CORE_FEATURE_KEYS.includes(key)).map((key) => [key, false])
          ),
        },
      },
    });

    // Seed the brain's root index — the space's home page, which the
    // Directory's Context tab routes to. Best-effort: never fail the create
    // over it.
    try {
      await ensureRootIndex(
        { spaceId: created.id, ownerKey: SHARED_OWNER_KEY },
        created.name,
        { id: session.userId, name: session.name, email: session.email }
      );
    } catch (err) {
      logger.warn('data.spaces.root_index_failed', { spaceId: created.id, err });
    }

    const createdSpace: Space = {
      id: created.id,
      name: created.name,
      description: created.description ?? '',
      location: created.location ?? undefined,
      tags: created.tags,
      memberCount: 0,
      createdAt: created.createdAt.toISOString(),
      imageUrl: created.imageUrl ?? undefined,
      nodeTypes: (created.nodeTypes as unknown) as Space['nodeTypes'],
      aliases: (created.aliases as unknown as SpaceAlias[]) ?? [],
    };

    return NextResponse.json({ space: createdSpace }, { status: 201 });
  } catch (err) {
    return handleApiError(err, 'api.data.spaces.post.failed');
  }
}

/**
 * PUT: Update an existing space
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await requireSession();
    if (session instanceof Response) return session;

    const body = await request.json();
    const { space } = body as { space: Space };

    // Must be admin of the space or super-admin
    if (!isSuperAdmin(session.email) && space.id && !(await isAdmin(session.userId, space.id, session.email))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!space.id) {
      return NextResponse.json(
        { error: 'space.id is required' },
        { status: 400 }
      );
    }

    if (!space.name) {
      return NextResponse.json(
        { error: 'Space must have name' },
        { status: 400 }
      );
    }

    // This path renames but never changes visibility, so the space stays as
    // public/private as it already was — a rename of a public space still has
    // to land on a free name (lib/spaces/publicName.ts).
    const current = await prisma.space.findUnique({
      where: { id: space.id },
      select: { name: true, visibility: true, personalOwnerId: true, nodeTypes: true },
    });
    if (!current) {
      return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    }
    const effective = effectiveNameAndVisibility({ name: space.name }, current);
    if (effective.isPublic && !current.personalOwnerId) {
      const clash = await findPublicNameConflict(effective.name, space.id);
      if (clash) {
        return NextResponse.json(
          { error: publicNameTakenMessage(clash.name), code: 'name_taken' },
          { status: 409 }
        );
      }
    }

    // Person aliases ARE the permission model, so a save here can strip one
    // that people hold and grants point at. Reconcile first: it refuses if the
    // space would be left with nobody owning it, drops the holders and
    // grants of every alias that disappeared, and returns the list to store —
    // with the `owner` flags carried over, since this page cannot edit them.
    let personAliasesToStore: SpaceAlias[];
    try {
      personAliasesToStore = await reconcilePersonAliases(
        space.id,
        ((space.aliases ?? []) as unknown as SpaceAlias[]),
      );
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
    const otherAliases = ((space.aliases ?? []) as unknown as SpaceAlias[])
      .filter((a) => a.nodeType?.toLowerCase() !== 'person');

    const updated = await prisma.space.update({
      where: { id: space.id },
      data: {
        name: space.name,
        description: space.description,
        location: space.location ?? null,
        tags: space.tags,
        imageUrl: space.imageUrl ?? null,
        // Additive: this is a whole-record save from a client snapshot that can
        // be minutes old, and any member may add a type in the meantime
        // (api/communities/[spaceId]/node-types). Overwriting verbatim is
        // how an admin recolouring Person silently deletes somebody's type.
        nodeTypes: mergeNodeTypeList(
          current.nodeTypes as NodeTypeConfig[] | null,
          space.nodeTypes as NodeTypeConfig[] | null,
        ) as unknown as object,
        aliases: [...otherAliases, ...personAliasesToStore] as unknown as object,
        linkTypes: space.linkTypes as object ?? null,
      },
    });

    const updatedSpace: Space = {
      id: updated.id,
      name: updated.name,
      description: updated.description ?? '',
      location: updated.location ?? undefined,
      tags: updated.tags,
      memberCount: space.memberCount,
      createdAt: updated.createdAt.toISOString(),
      imageUrl: updated.imageUrl ?? undefined,
      nodeTypes: (updated.nodeTypes as unknown) as Space['nodeTypes'],
      aliases: (updated.aliases as unknown as SpaceAlias[]) ?? [],
      linkTypes: (updated.linkTypes as unknown) as Space['linkTypes'],
    };

    revalidateTag('context-data', { expire: 0 });
    return NextResponse.json({ space: updatedSpace });
  } catch (err) {
    return handleApiError(err, 'api.data.spaces.put.failed');
  }
}

/**
 * DELETE: Delete a space
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await requireSession();
    if (session instanceof Response) return session;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'id is required' },
        { status: 400 }
      );
    }

    // Must be admin of the space or super-admin
    if (!isSuperAdmin(session.email) && !(await isAdmin(session.userId, id, session.email))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const exists = await prisma.space.findUnique({ where: { id }, select: { id: true } });
    if (!exists) {
      return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    }

    // Deleting the space cascades through every FK-backed relation (nodes,
    // links, notes, members, channels, grants…). These tables carry a
    // spaceId without a foreign key, so they must be swept by hand or
    // they'd survive as orphans.
    await prisma.$transaction([
      prisma.resource.deleteMany({ where: { spaceId: id } }),
      prisma.space.delete({ where: { id } }),
    ]);

    revalidateTag('context-data', { expire: 0 });

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err, 'api.data.spaces.delete.failed');
  }
}
