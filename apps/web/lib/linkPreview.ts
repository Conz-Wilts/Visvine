// OpenGraph unfurl with SSRF protection. Called from messageService after message create.
// Uses native fetch; no third-party dep required.

import prisma from '@/lib/prisma';
import net from 'node:net';

const URL_REGEX = /(https?:\/\/[^\s<>"']+)/g;
const FETCH_TIMEOUT_MS = 5000;
const MAX_BYTES = 500_000;

function extractUrls(text: string): string[] {
  return Array.from(new Set(text.match(URL_REGEX) ?? []));
}

function isPrivateHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname.endsWith('.local')) return true;
  if (net.isIP(hostname)) {
    // Block private IP ranges
    if (hostname.startsWith('10.') || hostname.startsWith('127.') || hostname === '0.0.0.0') return true;
    if (hostname.startsWith('192.168.') || hostname.startsWith('169.254.')) return true;
    const [a, b] = hostname.split('.').map(Number);
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (hostname === '::1' || hostname.startsWith('fc') || hostname.startsWith('fd')) return true;
  }
  return false;
}

function pickMeta(html: string, property: string): string | undefined {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']+)["']`, 'i');
  const m = html.match(re);
  return m?.[1];
}

function pickTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m?.[1]?.trim();
}

// Whether the response headers allow this origin-agnostic page to be iframed.
// Any X-Frame-Options or a CSP frame-ancestors directive is treated as blocking —
// we can't evaluate ancestor lists server-side, so err toward the fallback UI.
function isEmbeddable(headers: Headers): boolean {
  if (headers.get('x-frame-options')) return false;
  const csp = headers.get('content-security-policy') ?? '';
  return !/frame-ancestors/i.test(csp);
}

async function fetchLinkPreview(url: string) {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  if (isPrivateHost(parsed.hostname)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Visvine-LinkPreview/1.0' },
    });
    if (!res.ok) return null;
    const reader = res.body?.getReader();
    if (!reader) return null;
    let received = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      chunks.push(value);
      if (received >= MAX_BYTES) { await reader.cancel(); break; }
    }
    const html = new TextDecoder('utf-8').decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
    const title = pickMeta(html, 'og:title') ?? pickTitle(html);
    const description = pickMeta(html, 'og:description') ?? pickMeta(html, 'description');
    const imageUrl = pickMeta(html, 'og:image');
    const siteName = pickMeta(html, 'og:site_name');
    if (!title && !description && !imageUrl) return null;
    return {
      url,
      title: title ?? null,
      description: description ?? null,
      imageUrl: imageUrl ?? null,
      siteName: siteName ?? null,
      embeddable: isEmbeddable(res.headers),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Cache-or-fetch: serve the linkPreview row when fresh (<7 days), otherwise
// unfurl and upsert. `embeddable` is only known on a live fetch (it comes from
// response headers, not the DB) — undefined on cache hits.
export async function getOrFetchLinkPreview(url: string) {
  const cached = await prisma.linkPreview.findUnique({ where: { url } });
  const stale = cached && Date.now() - cached.fetchedAt.getTime() > 1000 * 60 * 60 * 24 * 7;
  if (cached && !stale) return { preview: cached, embeddable: undefined as boolean | undefined };
  const fetched = await fetchLinkPreview(url);
  if (!fetched) return { preview: cached ?? null, embeddable: undefined as boolean | undefined };
  const { embeddable, ...row } = fetched;
  const preview = await prisma.linkPreview.upsert({
    where: { url },
    create: row,
    update: { ...row, fetchedAt: new Date() },
  });
  return { preview, embeddable };
}

export async function attachPreviewsToMessage(messageId: string, text: string) {
  const urls = extractUrls(text).slice(0, 3);
  if (!urls.length) return;
  for (const url of urls) {
    try {
      const { preview } = await getOrFetchLinkPreview(url);
      if (!preview) continue;
      await prisma.messageLinkPreview.create({
        data: { messageId, linkPreviewId: preview.id },
      }).catch(() => {/* ignore dup */});
    } catch { /* ignore */ }
  }
}
