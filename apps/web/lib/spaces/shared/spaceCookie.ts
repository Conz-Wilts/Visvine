/**
 * The space this browser last stood in, as the part of its URL after `/s/`
 * (`acme` or `acme/growth`). Written by the proxy on every space URL and by the
 * switcher, read by the proxy only when an unprefixed page link names no space
 * of its own and the page it came from stood in none. Never authority: the page
 * still resolves the space against the viewer's memberships.
 */
export const SPACE_COOKIE = 'vv_space'

/** Request header carrying the `/s/…` prefix a rewritten page was reached under. */
export const SPACE_PREFIX_HEADER = 'x-visvine-space-prefix'
