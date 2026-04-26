import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deleteResourceFile, getSignedUrl, RESOURCES_BUCKET } from '@/lib/gcs';
import { getSession } from '@/lib/session';
import { z } from 'zod';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const community_id = req.nextUrl.searchParams.get('community_id');
  if (!community_id) return NextResponse.json({ error: 'community_id required' }, { status: 400 });
  const resources = await prisma.resource.findMany({
    where: { communityId: community_id },
    orderBy: { createdAt: 'desc' },
  });

  // Signed URLs stored in DB expire after 15 min — regenerate from gcsPath on every fetch.
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
  communityId: z.string().min(1),
  name: z.string().min(1).max(255),
  fileType: z.string().min(1).max(50),
  fileUrl: z.string().url(),
  fileSize: z.number().int().positive().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = CreateResourceSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const { communityId, name, fileType, fileUrl, fileSize, metadata } = parsed.data;
  const resource = await prisma.resource.create({
    data: { communityId, name, fileType, fileUrl, fileSize: fileSize ?? 0, uploadedBy: session.userId, metadata: (metadata ?? {}) as Record<string, string> },
  });
  return NextResponse.json(resource);
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const resource = await prisma.resource.findUnique({ where: { id } });
  if (!resource) return NextResponse.json({ error: 'Not found' }, { status: 404 });
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
