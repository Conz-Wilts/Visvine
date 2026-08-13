import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deleteResourceFile, getSignedUrl, RESOURCES_BUCKET } from '@/lib/gcs';
import { requireApiSession, parseBody } from '@/lib/api/route';
import { featureAccessForbidden } from '@/lib/auth';
import { z } from 'zod';

export async function GET(req: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const space_id = req.nextUrl.searchParams.get('space_id');
  if (!space_id) return NextResponse.json({ error: 'space_id required' }, { status: 400 });
  // A space that has removed Resources, or restricted it to admins, refuses here
  // too — not only in the sidebar that stopped showing the link.
  if (await featureAccessForbidden(session.userId, space_id, 'resources', session.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const resources = await prisma.resource.findMany({
    where: { spaceId: space_id },
    orderBy: { createdAt: 'desc' },
  });

  // Signed URLs stored in DB expire after 15 min — refresh from gcsPath on each
  // fetch (getSignedUrl serves from an in-memory TTL cache when still fresh).
  const withFreshUrls = await Promise.all(
    resources.map(async (r) => {
      const meta = r.metadata as Record<string, unknown> | null;
      const gcsPath = meta?.gcsPath as string | undefined;
      if (gcsPath) {
        try {
          const fileUrl = await getSignedUrl(RESOURCES_BUCKET(), gcsPath);
          return { ...r, fileUrl };
        } catch {
          // Leave stale URL rather than breaking the whole list
        }
      }
      return r;
    })
  );

  return NextResponse.json(withFreshUrls);
}

const CreateResourceSchema = z.object({
  spaceId: z.string().min(1),
  name: z.string().min(1).max(255),
  fileType: z.string().min(1).max(50),
  fileUrl: z.string().url(),
  fileSize: z.number().int().positive().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export async function POST(req: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const body = await parseBody(req, CreateResourceSchema);
  if (body instanceof NextResponse) return body;

  const { spaceId, name, fileType, fileUrl, fileSize, metadata } = body;
  if (await featureAccessForbidden(session.userId, spaceId, 'resources', session.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const resource = await prisma.resource.create({
    data: { spaceId, name, fileType, fileUrl, fileSize: fileSize ?? 0, uploadedBy: session.userId, metadata: (metadata ?? {}) as Record<string, string> },
  });
  return NextResponse.json(resource);
}

export async function DELETE(req: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const resource = await prisma.resource.findUnique({ where: { id } });
  if (!resource) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (await featureAccessForbidden(session.userId, resource.spaceId, 'resources', session.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  // Delete file from GCS (gcsPath stored in metadata, fallback to fileUrl for legacy records)
  try {
    const meta = resource.metadata as Record<string, unknown> | null;
    const gcsPath = (meta?.gcsPath as string | undefined) ?? resource.fileUrl;
    if (gcsPath && !gcsPath.startsWith('/uploads')) {
      await deleteResourceFile(gcsPath);
    }
  } catch {}
  await prisma.resource.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
