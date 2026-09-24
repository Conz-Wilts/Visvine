import { NextResponse } from 'next/server';
import { requireApiSession, handleApiError } from '@/lib/api/route';
import { getOrFetchLinkPreview, serializeLinkPreview } from '@/lib/linkPreview';

// GET /api/link-preview?url=<encoded> — what a page says about itself, as
// text. SSRF guards, timeout, and the 7-day linkPreview cache live in
// lib/linkPreview.ts; blocked/unfurlable URLs yield preview: null. Its images
// are never handed out to be hotlinked: a link that is a resource shows the
// copy its unfurl re-hosted (`/api/resources/<id>/thumb`).
export async function GET(request: Request) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  const url = new URL(request.url).searchParams.get('url') ?? '';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: 'Invalid url' }, { status: 400 });
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return NextResponse.json({ error: 'Invalid url' }, { status: 400 });
  }

  try {
    const { preview } = await getOrFetchLinkPreview(url);
    return NextResponse.json({ preview: preview ? serializeLinkPreview(preview) : null });
  } catch (error) {
    return handleApiError(error, 'link-preview.failed');
  }
}
