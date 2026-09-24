import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession, handleApiError } from '@/lib/api/route';
import { completeUpload } from '@/lib/resources/upload';

// Renditions and text are drained inside this request within a budget
// (lib/resources/service.ts#finishUpload); literal so Next can read it.
export const maxDuration = 60;

/** POST /api/resources/uploads/[uploadId]/complete — every byte is in: check it and make it a resource. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ uploadId: string }> }) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  try {
    const { uploadId } = await params;
    return NextResponse.json(await completeUpload(uploadId, session.userId));
  } catch (err) {
    return handleApiError(err, 'resources.uploads.complete');
  }
}
