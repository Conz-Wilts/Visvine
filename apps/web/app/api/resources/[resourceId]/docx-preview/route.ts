import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join, sep } from 'path';
import prisma from '@/lib/prisma';
import { requireApiSession, forbiddenResponse, handleApiError } from '@/lib/api/route';

// Mammoth emits well-formed HTML derived from docx. The primary XSS control is
// the sandboxed (no-scripts) iframe the client renders this in; this scrub is
// belt-and-braces and now also catches unquoted event handlers and whitespace-
// obfuscated `javascript:` that the old quoted-only pattern let through.
function stripExecutable(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<\s*(iframe|object|embed|link|meta|base)\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '') // unquoted: onerror=alert(1)
    .replace(/j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:/gi, '');
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ resourceId: string }> }) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const { resourceId } = await params;
  const resource = await prisma.resource.findUnique({ where: { id: resourceId } });
  if (!resource) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const membership = await prisma.spaceMember.findUnique({
    where: { userId_spaceId: { userId: session.userId, spaceId: resource.spaceId } },
    select: { id: true },
  });
  if (!membership) return forbiddenResponse();

  if (!/\.docx?$/i.test(resource.name) && resource.fileType !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return NextResponse.json({ error: 'Not a docx' }, { status: 400 });
  }

  // This preview only ever served the LEGACY local-uploads layout, where
  // `fileUrl` was a path under public/. Files stored in GCS (everything uploaded
  // since) are previewed client-side from their signed URL instead, so a row
  // without a local path simply has no local preview to render.
  if (!resource.fileUrl || resource.fileUrl.startsWith('http')) {
    return NextResponse.json({ error: 'No local preview for this file' }, { status: 404 });
  }
  // `fileUrl` is a DB value that becomes a filesystem path — refuse traversal so
  // it can never resolve outside the public assets root even if a write path
  // ever lets a `../` into the column.
  const publicRoot = join(process.cwd(), 'public');
  const filePath = join(publicRoot, resource.fileUrl);
  if (!filePath.startsWith(publicRoot + sep)) {
    return NextResponse.json({ error: 'Invalid resource path' }, { status: 400 });
  }

  try {
    const buf = await readFile(filePath);
    const mammoth = await import('mammoth');
    const result = await mammoth.convertToHtml({ buffer: buf });
    return new NextResponse(stripExecutable(result.value), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // Even though the client sandboxes this, a strict CSP means a direct hit
        // on the URL can't execute scripts either.
        'Content-Security-Policy': "default-src 'none'; img-src data: https:; style-src 'unsafe-inline'",
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    return handleApiError(err, 'api.resources.docxPreview.failed');
  }
}
