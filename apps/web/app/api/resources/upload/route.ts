import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession, forbiddenResponse } from '@/lib/api/route';
import { featureAccessForbidden } from '@/lib/auth';
import { MAX_RESOURCE_BYTES, uploadResource } from '@/lib/resources/service';

// Extraction + embedding run inline (see lib/resources/service.ts), and a large
// spreadsheet can be a few batched embedding calls. Literal so Next can read it.
export const maxDuration = 300;

/**
 * Upload a file into a space's Drive: store the bytes, record the file, and run
 * it through the RAG pipeline so its contents are searchable.
 *
 * One call, where there used to be two. The old flow uploaded here and then had
 * the BROWSER post the resulting record — object path included — to
 * POST /api/resources, which is how a client came to control which object the
 * server would later sign a URL for. It also meant `spaceId` was optional here
 * (the dialog never sent it), so the membership check below was skipped and
 * files landed under a `resources/unscoped/` prefix belonging to nobody.
 */
export async function POST(req: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  const spaceId = formData.get('spaceId') as string | null;

  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 });
  if (!spaceId) return NextResponse.json({ error: 'spaceId is required' }, { status: 400 });
  if (file.size > MAX_RESOURCE_BYTES) {
    return NextResponse.json(
      { error: `File must be less than ${Math.floor(MAX_RESOURCE_BYTES / 1024 / 1024)}MB` },
      { status: 400 },
    );
  }
  // The same gate the listing uses: a space that removed Resources, or restricted
  // it to admins, does not accept uploads into it either.
  if (await featureAccessForbidden(session.userId, spaceId, 'resources', session.email)) {
    return forbiddenResponse();
  }

  try {
    const resource = await uploadResource({
      spaceId,
      filename: file.name,
      mimeType: file.type,
      buffer: Buffer.from(await file.arrayBuffer()),
      uploadedBy: session.userId,
    });
    return NextResponse.json(resource);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
