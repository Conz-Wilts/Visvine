import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApiError, parseBody, requireApiSession } from '@/lib/api/route';
import { featureAccessForbidden } from '@/lib/auth';
import { createFolder, listFolders } from '@/lib/resources/folders';

/** GET /api/resources/folders?space_id= — every folder in the space, flat. */
export async function GET(req: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const spaceId = req.nextUrl.searchParams.get('space_id');
  if (!spaceId) return NextResponse.json({ error: 'space_id required' }, { status: 400 });
  if (await featureAccessForbidden(session.userId, spaceId, 'resources', session.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(await listFolders(spaceId));
}

const createSchema = z.object({
  spaceId: z.string().min(1),
  name: z.string().min(1).max(200),
  parentId: z.string().min(1).nullable().optional(),
});

/** POST /api/resources/folders — a new folder, at the root or inside another. */
export async function POST(req: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const body = await parseBody(req, createSchema);
  if (body instanceof NextResponse) return body;

  if (await featureAccessForbidden(session.userId, body.spaceId, 'resources', session.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    const folder = await createFolder({
      spaceId: body.spaceId,
      name: body.name,
      parentId: body.parentId ?? null,
      createdBy: session.userId,
    });
    return NextResponse.json(folder, { status: 201 });
  } catch (err) {
    return handleApiError(err, 'resources.folders.create');
  }
}
