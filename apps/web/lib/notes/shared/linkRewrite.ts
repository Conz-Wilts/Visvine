// Markdown link rewriting for note moves — ported from the rewriteLinks part of
// blackbird-brain's src/shared/markdown.ts. When a note moves, every inbound
// OKF markdown link is rewritten to the new path so nothing breaks. Pure.

import { resolveOkfLink } from './markdown'

// Matches [text](href) capturing text and href; skips images (![alt](src)).
const LINK_RE = /(?<!!)\[([^\]]*)\]\(([^)\s"]+)([^)]*)\)/g

/**
 * Rewrite the hrefs in `body` (of the note at `fromNotePath`) wherever the
 * resolved target matches `map` (resolved target path → new target path, or
 * null to leave unchanged). Rewritten links use notes-root-absolute hrefs
 * (`/new/path.md`) so they stay valid regardless of the source note's folder.
 */
export function rewriteLinks(
  body: string,
  fromNotePath: string,
  map: (resolvedTarget: string) => string | null,
): string {
  return body.replace(LINK_RE, (whole, text: string, href: string, rest: string) => {
    if (
      href.startsWith('http://') ||
      href.startsWith('https://') ||
      href.startsWith('mailto:') ||
      href.startsWith('#')
    ) {
      return whole
    }
    const resolved = resolveOkfLink(href, fromNotePath)
    if (!resolved) return whole
    const next = map(resolved)
    if (!next) return whole
    return `[${text}](/${next}${rest})`
  })
}
