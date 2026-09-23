// Link unfurling with SSRF protection: the I/O around `lib/links/shared/unfurl.ts`.
// Called after a message is sent or edited, by the link-preview route, and when
// a link becomes a resource. Uses native fetch; no third-party dep required.

import prisma from '@/lib/prisma';
import { assertPubliclyRoutable, SsrfError } from '@/lib/net/ssrf';
import {
  extractUrls,
  mediaTypeOfContentType,
  mediaUnfurl,
  oembedHrefOf,
  parseHead,
  type OEmbed,
  type Unfurl,
} from '@/lib/links/shared/unfurl';
import type { SerializedLinkPreview } from '@/lib/messages/types';

const FETCH_TIMEOUT_MS = 5000;
// Every tag a preview reads is in the head; reading stops at `</head>` or here.
const MAX_HEAD_BYTES = 256_000;
const MAX_OEMBED_BYTES = 64_000;
const MAX_REDIRECTS = 4;
/** Links unfurled per message, as Slack caps the cards under one message. */
const MAX_PREVIEWS_PER_MESSAGE = 5;

/**
 * Fetch `url` with SSRF protection at every hop. This unfurler runs server-side
 * on any user-supplied URL, so it must not be steerable at internal services.
 * The shared `assertPubliclyRoutable` actually resolves the host (unlike the old
 * literal-string check that a DNS name pointing at 169.254.169.254 walked
 * straight past), and `redirect: 'manual'` means a public first hop can't 302
 * us onto an internal target — each redirect Location is re-validated here.
 */
async function ssrfSafeFetch(url: string, signal: AbortSignal): Promise<Response | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let parsed: URL;
    try { parsed = new URL(current); } catch { return null; }
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    try {
      await assertPubliclyRoutable(parsed.hostname);
    } catch (err) {
      if (err instanceof SsrfError) return null;
      throw err;
    }
    const res = await fetch(current, {
      signal,
      redirect: 'manual',
      headers: { 'User-Agent': 'Visvine-LinkPreview/1.0' },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return null;
      current = new URL(location, current).toString(); // resolve relative redirects, re-validate next loop
      continue;
    }
    return res;
  }
  return null; // too many redirects
}

// Whether the response headers allow this origin-agnostic page to be iframed.
// Any X-Frame-Options or a CSP frame-ancestors directive is treated as blocking —
// we can't evaluate ancestor lists server-side, so err toward the fallback UI.
function isEmbeddable(headers: Headers): boolean {
  if (headers.get('x-frame-options')) return false;
  const csp = headers.get('content-security-policy') ?? '';
  return !/frame-ancestors/i.test(csp);
}

/** Up to `maxBytes` of the body as text, stopping early once `stopAt` is seen. */
async function readText(res: Response, maxBytes: number, stopAt?: RegExp): Promise<string | null> {
  const reader = res.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder('utf-8');
  let text = '';
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    text += decoder.decode(value, { stream: true });
    if (received >= maxBytes || (stopAt && stopAt.test(text))) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return text;
}

async function fetchOEmbed(href: string, signal: AbortSignal): Promise<OEmbed | null> {
  try {
    const res = await ssrfSafeFetch(href, signal);
    if (!res || !res.ok) return null;
    const body = await readText(res, MAX_OEMBED_BYTES);
    if (!body) return null;
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === 'object' ? (parsed as OEmbed) : null;
  } catch {
    return null;
  }
}

/**
 * Unfurl one URL: a media URL previews as itself, a page from its head — its
 * oEmbed answer first when it names one, then Open Graph, Twitter, `<title>`.
 * Null when the URL is refused, unreachable, or says nothing previewable.
 */
async function fetchLinkPreview(url: string): Promise<(Unfurl & { url: string; embeddable: boolean }) | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await ssrfSafeFetch(url, controller.signal);
    if (!res || !res.ok) return null;
    const embeddable = isEmbeddable(res.headers);
    const media = mediaTypeOfContentType(res.headers.get('content-type'));
    if (media) {
      await res.body?.cancel().catch(() => {});
      return { url, embeddable, ...mediaUnfurl(url, media) };
    }
    const html = await readText(res, MAX_HEAD_BYTES, /<\/head\s*>/i);
    if (!html) return null;
    const oembedHref = oembedHrefOf(html, res.url || url);
    const oembed = oembedHref ? await fetchOEmbed(oembedHref, controller.signal) : null;
    const unfurl = parseHead(html, res.url || url, oembed);
    return unfurl ? { url, embeddable, ...unfurl } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const PREVIEW_TTL_MS = 1000 * 60 * 60 * 24 * 7;

// Cache-or-fetch: serve the linkPreview row when fresh (<7 days), otherwise
// unfurl and upsert. A row cached before media types were read is stale, so it
// picks up its favicon and type on the next look. `embeddable` is only known on
// a live fetch (it comes from response headers, not the DB) — undefined on hits.
export async function getOrFetchLinkPreview(url: string) {
  const cached = await prisma.linkPreview.findUnique({ where: { url } });
  const stale = cached && (!cached.mediaType || Date.now() - cached.fetchedAt.getTime() > PREVIEW_TTL_MS);
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

/**
 * Make a message's cards match its text: a link it no longer holds loses its
 * card, a new one is unfurled. Run after a send and after an edit.
 */
export async function attachPreviewsToMessage(messageId: string, text: string) {
  const urls = extractUrls(text).slice(0, MAX_PREVIEWS_PER_MESSAGE);
  const existing = await prisma.messageLinkPreview.findMany({
    where: { messageId },
    select: { id: true, linkPreview: { select: { url: true } } },
  });
  const had = new Set(existing.map((row) => row.linkPreview.url));
  const gone = existing.filter((row) => !urls.includes(row.linkPreview.url)).map((row) => row.id);
  if (gone.length) await prisma.messageLinkPreview.deleteMany({ where: { id: { in: gone } } });
  for (const url of urls) {
    if (had.has(url)) continue;
    try {
      const { preview } = await getOrFetchLinkPreview(url);
      if (!preview) continue;
      await prisma.messageLinkPreview.create({
        data: { messageId, linkPreviewId: preview.id },
      }).catch(() => {/* ignore dup */});
    } catch { /* ignore */ }
  }
}

type LinkPreviewRow = {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
  faviconUrl: string | null;
  mediaType: string | null;
  imageLayout: string | null;
};

/** The client's shape of a cached preview — one serializer for every surface. */
export function serializeLinkPreview(row: LinkPreviewRow): SerializedLinkPreview {
  return {
    url: row.url,
    title: row.title,
    description: row.description,
    imageUrl: row.imageUrl,
    siteName: row.siteName,
    faviconUrl: row.faviconUrl,
    mediaType: row.mediaType,
    imageLayout: row.imageLayout === 'summary' ? 'summary' : row.imageLayout === 'large' ? 'large' : null,
  };
}
