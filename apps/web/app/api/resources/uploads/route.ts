import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiSession, parseBody, handleApiError } from '@/lib/api/route';
import { initUpload } from '@/lib/resources/upload';

const initSchema = z.object({
  spaceId: z.string().min(1),
  name: z.string().trim().min(1).max(255),
  size: z.number().int().positive(),
  mimeType: z.string().max(200).optional(),
  folderId: z.string().min(1).nullable().optional(),
  nodeId: z.string().min(1).nullable().optional(),
  conversationId: z.string().min(1).nullable().optional(),
});

/**
 * POST /api/resources/uploads — open a resumable upload
 * (lib/resources/upload.ts). Returns where to PUT the chunks: the bucket's own
 * session URI, or this app's local stand-in.
 */
export async function POST(req: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const body = await parseBody(req, initSchema);
  if (body instanceof NextResponse) return body;
  try {
    const origin = req.headers.get('origin') ?? req.nextUrl.origin;
    const started = await initUpload({ ...body, userId: session.userId, email: session.email, origin });
    return NextResponse.json(started, { status: 201 });
  } catch (err) {
    return handleApiError(err, 'resources.uploads.init');
  }
}
