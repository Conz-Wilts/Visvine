import { NextRequest, NextResponse } from 'next/server';
import { getApiMessagingUser, unauthorizedResponse } from '@/lib/messages/auth';
import prisma from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    const user = await getApiMessagingUser();
    if (!user) return unauthorizedResponse();

    const url = request.nextUrl.searchParams.get('url');
    if (!url) {
      return NextResponse.json({ error: 'url parameter required' }, { status: 400 });
    }

    // Check cache first
    const cached = await prisma.linkPreview.findUnique({ where: { url } });
    if (cached) {
      return NextResponse.json({
        url: cached.url,
        title: cached.title,
        description: cached.description,
        imageUrl: cached.imageUrl,
        siteName: cached.siteName,
      });
    }

    // Fetch and parse OG tags
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'VisvineBot/1.0' },
        redirect: 'follow',
      });
      clearTimeout(timeout);

      if (!res.ok) {
        return NextResponse.json({ error: 'Failed to fetch URL' }, { status: 422 });
      }

      const html = await res.text();
      const title = extractMeta(html, 'og:title') ?? extractTitle(html);
      const description = extractMeta(html, 'og:description') ?? extractMeta(html, 'description');
      const imageUrl = extractMeta(html, 'og:image');
      const siteName = extractMeta(html, 'og:site_name');

      // Cache the result
      const preview = await prisma.linkPreview.create({
        data: { url, title, description, imageUrl, siteName },
      });

      return NextResponse.json({
        url: preview.url,
        title: preview.title,
        description: preview.description,
        imageUrl: preview.imageUrl,
        siteName: preview.siteName,
      });
    } catch {
      clearTimeout(timeout);
      return NextResponse.json({ error: 'Failed to fetch URL' }, { status: 422 });
    }
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

function extractMeta(html: string, property: string): string | null {
  // Try og: property first, then name
  const ogRegex = new RegExp(
    `<meta[^>]*(?:property|name)=["'](?:og:)?${property}["'][^>]*content=["']([^"']*)["']`,
    'i',
  );
  const match = html.match(ogRegex);
  if (match?.[1]) return match[1];

  // Try reversed attribute order (content before property)
  const reverseRegex = new RegExp(
    `<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["'](?:og:)?${property}["']`,
    'i',
  );
  const reverseMatch = html.match(reverseRegex);
  return reverseMatch?.[1] ?? null;
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match?.[1]?.trim() ?? null;
}
