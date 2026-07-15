import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';
import prisma from '@/lib/prisma';
import { requireApiSession, forbiddenResponse, handleApiError } from '@/lib/api/route';

// Mammoth emits well-formed HTML derived from docx, but belt-and-braces:
// strip anything that could execute JS even if mammoth's behavior changes
// or the upload vector widens in the future.
function stripExecutable(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '');
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ resourceId: string }> }) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const { resourceId } = await params;
  const resource = await prisma.resource.findUnique({ where: { id: resourceId } });
  if (!resource) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const membership = await prisma.userCommunity.findUnique({
    where: { userId_communityId: { userId: session.userId, communityId: resource.communityId } },
    select: { id: true },
  });
  if (!membership) return forbiddenResponse();

  if (!/\.docx?$/i.test(resource.name) && resource.fileType !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return NextResponse.json({ error: 'Not a docx' }, { status: 400 });
  }

  try {
    const filePath = join(process.cwd(), 'public', resource.fileUrl);
    const buf = await readFile(filePath);
    const mammoth = await import('mammoth');
    const result = await mammoth.convertToHtml({ buffer: buf });
    return new NextResponse(stripExecutable(result.value), { headers: { 'Content-Type': 'text/html' } });
  } catch (err) {
    return handleApiError(err, 'api.resources.docxPreview.failed');
  }
}
