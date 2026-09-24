import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession, handleApiError } from '@/lib/api/route';
import { downloadResourceFile } from '@/lib/gcs';
import { requireVisibleResource } from '@/lib/resources/visibility';

// Mammoth emits well-formed HTML derived from docx. The primary XSS control is
// the sandboxed (no-scripts) iframe the client renders this in; this scrub is
// belt-and-braces and also catches unquoted event handlers and whitespace-
// obfuscated `javascript:`.
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
  let resource;
  try {
    resource = await requireVisibleResource(resourceId, session.userId, session.email);
  } catch (err) {
    return handleApiError(err, 'api.resources.docxPreview.gate');
  }

  if (resource.kind !== 'doc' || !/\.docx?$/i.test(resource.name)) {
    return NextResponse.json({ error: 'Not a docx' }, { status: 400 });
  }

  // The bytes live in the Drive's bucket; a row without an object has nothing
  // to render (a seeded demo file, or an upload whose object was lost).
  if (!resource.gcsPath) {
    return NextResponse.json({ error: 'The original file is not in storage' }, { status: 404 });
  }

  try {
    const buf = await downloadResourceFile(resource.gcsPath);
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
