import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { handleApiError, parseBody, requireApiSession } from '@/lib/api/route';
import { featureAccessForbidden } from '@/lib/auth';
import { deleteFolder, updateFolder } from '@/lib/resources/folders';

type Params = { params: Promise<{ folderId: string }> };

/** The folder's space, after the same feature gate the listing applies. */
async function gate(folderId: string, userId: string, email: string) {
  const folder = await prisma.resourceFolder.findUnique({ where: { id: folderId }, select: { spaceId: true } });
  if (!folder) return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
  if (await featureAccessForbidden(userId, folder.spaceId, 'resources', email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return folder;
}

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  parentId: z.string().min(1).nullable().optional(),
});

/** PATCH — rename and/or move the folder. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const { folderId } = await params;
  const gated = await gate(folderId, session.userId, session.email);
  if (gated instanceof NextResponse) return gated;
  const body = await parseBody(req, patchSchema);
  if (body instanceof NextResponse) return body;
  try {
    return NextResponse.json(await updateFolder(folderId, body));
  } catch (err) {
    return handleApiError(err, 'resources.folders.update');
  }
}

/** DELETE — subfolders go with it; files inside are lifted to the parent. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const { folderId } = await params;
  const gated = await gate(folderId, session.userId, session.email);
  if (gated instanceof NextResponse) return gated;
  try {
    await deleteFolder(folderId);
    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err, 'resources.folders.delete');
  }
}
