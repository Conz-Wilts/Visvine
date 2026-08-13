/**
 * Shared media URL utilities — safe for both client and server.
 *
 * The GCS migration script stored direct URLs like
 *   https://storage.googleapis.com/<media-bucket>/media/person:foo/avatar-lg.webp
 * These break in the browser (private bucket, no CORS). This module rewrites
 * them to the /api/media/ proxy path which handles GCS auth server-side.
 */

const DIRECT_GCS_RE = /^https?:\/\/storage\.googleapis\.com\/[^/]+\//;

/**
 * Remote hosts that are declared in next.config.ts `images.remotePatterns`,
 * i.e. safe to pass through the next/image optimizer. Relative URLs
 * (the /api/media/ proxy) are always optimizable — same-origin needs no
 * remotePatterns entry.
 *
 * Anything else (arbitrary link-preview hosts, the GCS CDN host which is only
 * known server-side via GCS_CDN_HOSTNAME) should render with
 * `unoptimized` so next/image doesn't throw on an unconfigured hostname.
 */
const OPTIMIZABLE_HOSTS = new Set([
  'lh3.googleusercontent.com',
  'storage.googleapis.com',
]);

/**
 * True when a URL can go through the next/image optimizer (relative
 * same-origin path, or a host listed in next.config remotePatterns).
 * data:/blob: URLs return false — those must stay raw <img>.
 */
export function isOptimizableImageUrl(url: string): boolean {
  if (url.startsWith('/')) return true;
  try {
    return OPTIMIZABLE_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Build a proxy URL for a GCS media object path.
 * On the server, uses GCS_CDN_BASE_URL if configured; otherwise falls back to
 * the /api/media/ proxy (works on both client and server).
 */
export function getMediaProxyUrl(objectPath: string): string {
  const cdnBase =
    typeof process !== 'undefined' ? process.env?.GCS_CDN_BASE_URL : undefined;
  if (cdnBase) {
    return `${cdnBase.replace(/\/$/, '')}/${objectPath}`;
  }
  return `/api/media/${objectPath}`;
}

/**
 * Fix legacy GCS object paths.
 *
 * Some DB rows still have URLs with a `media/` prefix from before the GCS
 * folder structure was standardised. The actual objects live under the
 * current layout:
 *   cards/{nodeId}/…       (all node types including person:, org:, etc.)
 *   persons/{personId}/…   (person records in the persons table)
 *   communities/{id}/…
 *
 * The upload route uses ENTITY_PREFIXES { card → 'cards', person → 'persons',
 * space → 'communities' }. Node images (table view) always go to 'cards/'
 * regardless of node type.
 */
function normalizeObjectPath(objectPath: string): string {
  // media/person:foo/… → cards/person:foo/…   (node images live under cards/)
  // media/community:foo/… → communities/community:foo/…
  // media/anything-else/… → cards/anything-else/…
  if (objectPath.startsWith('media/')) {
    const rest = objectPath.slice('media/'.length);
    if (rest.startsWith('space:')) {
      return `communities/${rest}`;
    }
    return `cards/${rest}`;
  }
  return objectPath;
}

/**
 * Normalise a stored image URL so it routes through the media proxy.
 * - Direct GCS URLs are rewritten to /api/media/…
 * - Legacy `media/` object paths are mapped to current folder structure.
 * - Proxy URLs and other URLs are returned as-is.
 * - null/undefined → null
 */
export function normalizeImageUrl(
  url: string | null | undefined
): string | null {
  if (!url) return null;
  if (DIRECT_GCS_RE.test(url)) {
    const objectPath = url.replace(DIRECT_GCS_RE, '');
    return getMediaProxyUrl(normalizeObjectPath(objectPath));
  }
  return url;
}
