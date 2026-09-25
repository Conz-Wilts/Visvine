import { NextRequest, NextResponse } from 'next/server';
import { spaceForPhone, toolClientOf } from '@/lib/tools/clientClass';
import { revalidateTag } from 'next/cache';
import prisma from '@/lib/prisma';
import { getSessionInfo, requireSession, isSuperAdmin } from '@/lib/session';
import { isAdmin } from '@/lib/auth';
import { purgeSpaceObjects } from '@/lib/storage/purge';
import {
  mergeNodeTypeList,
  type Space,
  type SpaceAlias,
  type NodeTypeConfig,
  type LinkTypeConfig,
} from '@/lib/types';
import { handleApiError } from '@/lib/api/route';
import { listVisibleSpaces } from '@/lib/spaces/queries';
import {
  effectiveNameAndVisibility,
  findPublicNameConflict,
  publicNameTakenMessage,
} from '@/lib/spaces/publicName';
import { defaultFeatureConfig } from '@/lib/featureAccess';
import { coerceTrackedFields } from '@/lib/directory/table';
import { findSiblingNameConflict, listLockedSubspaces, listSubspaces } from '@/lib/spaces/subspaceAccess';
import { updateSpaceConfig } from '@/lib/spaces/spaceConfig';
import { mergeAliasList, mergeLinkTypeList } from '@/lib/spaces/configMerge';
import { ensureRootIndex, SHARED_OWNER_KEY } from '@/lib/notes/store';
import { logger } from '@/lib/logger';

/**
 * GET: Fetch all spaces
 */
export async function GET() {
  try {
    const session = await requireSession();
    if (session instanceof Response) return session;

    // Two lists, deliberately different shapes: the spaces the caller is in or
    // can discover, and the private sub-spaces they can see the door of but not
    // open (lib/spaces/subspaceAccess.ts#listLockedSubspaces). A locked row
    // carries a name and nothing a member of it would recognise as config.
    const [spaces, locked] = await Promise.all([
      listVisibleSpaces(session),
      listLockedSubspaces(session.userId),
    ]);
    // Not locked to someone who already reaches it (a parent's admin, via
    // `parentAdmins` — lib/spaces/queries.ts).
    const lockedSubspaces = locked.filter((l) => !spaces.some((s) => s.id === l.id));
    // A phone app runs no Tools, so it is sent none (lib/tools/clientClass.ts).
    const info = await getSessionInfo();
    const phone = info !== null && toolClientOf(info) === 'mobile';

    return NextResponse.json(
      { spaces: phone ? spaces.map(spaceForPhone) : spaces, lockedSubspaces },
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
        // Same defaults as the user-facing create: private, Directory plus the
        // DEFAULT_ON set (Tools — marketplace and community-built Tools).
        visibility: space.visibility === 'public' ? 'public' : 'private',
        featureConfig: defaultFeatureConfig() as object,
      },
    });

    // Seed the context's root index — the space's home page, which the
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
      select: { name: true, visibility: true, personalOwnerId: true, parentId: true },
    });
    if (!current) {
      return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    }
    const effective = effectiveNameAndVisibility({ name: space.name }, current);
    // A sub-space's name is unique among its siblings whatever its visibility
    // (`spaces_sibling_name_unique`), so two sub-spaces of one space can never
    // be told apart by name alone. The user-facing create and rename both ask
    // this; without it here the index refused the write as a raw P2002, which
    // reached the caller as a 500 and Error Reporting as a fault.
    if (current.parentId) {
      const sibling = await findSiblingNameConflict(current.parentId, effective.name, space.id);
      if (sibling) {
        return NextResponse.json({ error: sibling.message, code: 'name_taken' }, { status: 409 });
      }
    }
    if (effective.isPublic && !current.personalOwnerId) {
      const clash = await findPublicNameConflict(effective.name, space.id);
      if (clash) {
        return NextResponse.json(
          { error: publicNameTakenMessage(clash.name), code: 'name_taken' },
          { status: 409 }
        );
      }
    }

    // A type's tracked fields decide what the Directory's table shows and what
    // `PATCH /api/nodes/<id>` will accept into a node's metadata, so a malformed
    // one is refused here rather than stored and skipped later. This was checked
    // on the way through settings/types.md while the config was mirrored into a
    // note; the column is the only door now, so the check lives on it.
    for (const type of (space.nodeTypes ?? []) as NodeTypeConfig[]) {
      if (type?.fields === undefined) continue;
      const fields = coerceTrackedFields(type.fields);
      if ('error' in fields) {
        return NextResponse.json(
          { error: `${type.name ?? 'a type'}: ${fields.error}` },
          { status: 400 },
        );
      }
    }

    // Every vocabulary column here is additive, and all three are merged under
    // the space lock. This is a whole-record save from a client snapshot that
    // can be minutes old: a member may have added a node type
    // (api/spaces/[spaceId]/node-types), an admin may have created an alias
    // on Members, MCP may have added one through manage_alias. Writing the
    // snapshot verbatim is how any of those silently disappear — and for
    // aliases, disappearing used to take their holders and grants with them.
    // Removing something is a deliberate act with its own endpoint.
    const { space: updated } = await updateSpaceConfig(
      space.id,
      (stored) => ({
        nodeTypes: mergeNodeTypeList(stored.nodeTypes, space.nodeTypes as NodeTypeConfig[] | null),
        aliases: mergeAliasList(stored.aliases, space.aliases as SpaceAlias[] | null),
        linkTypes: mergeLinkTypeList(stored.linkTypes, space.linkTypes as LinkTypeConfig[] | null),
      }),
      {
        also: {
          name: space.name,
          description: space.description,
          location: space.location ?? null,
          tags: space.tags,
          imageUrl: space.imageUrl ?? null,
        },
        skipRevalidate: true,
      },
    );

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

    // Bytes first: the media bucket is keyed by ENTITY id, so a node's images
    // are only findable while the node still exists. Best-effort by design —
    // an orphaned object costs storage, a failed purge that aborted the delete
    // would cost the admin their delete. scripts/gc-orphan-objects.ts reconciles.
    await purgeSpaceObjects(id).catch((err) =>
      logger.error('api.data.spaces.delete.purge_failed', { spaceId: id, err })
    );

    // A space's sub-spaces go with it — they live under it, and the console's
    // confirmation says how many. Children first, each purged like the parent,
    // because the parent relation is Restrict on purpose (a cascade here would
    // be a tenant wipe nobody spelled out).
    for (const sub of await listSubspaces(id)) {
      await purgeSpaceObjects(sub.id).catch((err) =>
        logger.error('api.data.spaces.delete.purge_failed', { spaceId: sub.id, err })
      );
      await prisma.space.delete({ where: { id: sub.id } });
    }

    // Then the rows. Everything cascades from the space now — `resources` grew
    // its foreign key in 20260823120100_resources_drive, so the hand-sweep that
    // used to stand here is gone (and it was the very thing that skipped the
    // bucket, since deleteMany never reaches the service that owns the bytes).
    await prisma.space.delete({ where: { id } });

    revalidateTag('context-data', { expire: 0 });

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err, 'api.data.spaces.delete.failed');
  }
}
