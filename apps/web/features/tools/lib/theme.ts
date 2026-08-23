/**
 * The theme the host hands a Tool at handshake time.
 *
 * A Tool renders in a sandboxed iframe on another origin: it cannot see the
 * app's stylesheet, and it must not be able to. So the host reads the custom
 * properties the app is *currently painted with* — including whatever accent
 * ThemeContext wrote onto `:root` a moment ago — and posts them across as a flat
 * map, which the frame runtime sets back onto its own `:root`. That is the whole
 * mechanism behind "marketplace Tools don't look like twelve different
 * websites".
 *
 * Every token goes over twice: under the app's own name (`--color-brand-green`,
 * `--text-muted`), because a Tool author may reference those directly, and under
 * a stable `--vv-*` alias the kit's stylesheet is written against
 * (features/tools/kit/styles.ts). The aliases are the contract — the app's
 * internal variable names may be renamed one day, and an installed Tool pinned
 * to an old version must not repaint wrong when they are.
 *
 * The computed values are read behind a plain `(name) => string` reader so the
 * mapping itself is pure and testable without a DOM.
 */

/**
 * app variable → `--vv-*` alias → the value used when the app has not painted
 * one (server render, or a Tool previewed outside the themed shell). The
 * fallbacks are the same literals `KIT_CSS` carries, so a missing token is never
 * an unstyled Tool.
 */
const THEME_TOKENS: ReadonlyArray<readonly [source: string, alias: string, fallback: string]> = [
  // Accent — the one token a space actually changes (ThemeContext#applyAll).
  ['--color-brand-green', '--vv-accent', '#78d870'],
  ['--color-brand-dark-green', '--vv-accent-strong', '#2f7a3e'],
  ['--color-brand-light-bg', '--vv-accent-soft', '#eaf9ec'],
  // The page backdrop — the viewer's chosen gradient, or plain white. A Tool
  // rarely paints this itself (the frame is transparent, so the app's own
  // backdrop already shows through); it goes over so a Tool that must know
  // the value (a canvas, an exported image) reads the real one.
  ['--app-backdrop', '--vv-backdrop', '#ffffff'],
  // Surfaces and borders.
  ['--surface-1', '--vv-surface', '#ffffff'],
  ['--surface-2', '--vv-surface-2', '#f9fafb'],
  ['--surface-3', '--vv-surface-3', '#f3f4f6'],
  ['--border-subtle', '--vv-border', '#e5e7eb'],
  ['--border-default', '--vv-border-strong', '#d1d5db'],
  // Text.
  ['--text-primary', '--vv-text', '#111827'],
  ['--text-secondary', '--vv-text-secondary', '#374151'],
  ['--text-muted', '--vv-text-muted', '#4b5563'],
  // Type. `--font-utility` is the product's body face; the brand face is
  // marketing-only (app/globals.css) and is deliberately not published.
  [
    '--font-utility',
    '--vv-font',
    "'Open Sauce One', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  ],
]

/** Reads one custom property's computed value; '' when it is not set. */
export type ThemeReader = (name: string) => string

/**
 * The pure half: map whatever the reader knows onto the wire map. A blank or
 * whitespace-only value counts as unset and takes the fallback, because
 * `getComputedStyle().getPropertyValue()` returns '' for a property no rule ever
 * declared and a Tool given `--vv-accent: ` paints nothing at all.
 */
export function themeTokensFrom(read: ThemeReader): Record<string, string> {
  const tokens: Record<string, string> = {}
  for (const [source, alias, fallback] of THEME_TOKENS) {
    const raw = read(source).trim()
    const value = raw || fallback
    tokens[source] = value
    tokens[alias] = value
  }
  return tokens
}

/**
 * The theme as the app is painting it right now.
 *
 * Read from `:root` first and then `body`, which is where a scoped override
 * would sit if one is ever added; the first non-empty wins. Call this at
 * handshake time rather than at mount — ThemeContext applies its variables in an
 * effect, and a child's effect runs before its provider's.
 */
export function collectThemeTokens(doc: Document): Record<string, string> {
  const view = doc.defaultView
  if (!view) return themeTokensFrom(() => '')
  const root = view.getComputedStyle(doc.documentElement)
  const body = doc.body ? view.getComputedStyle(doc.body) : null
  return themeTokensFrom(
    (name) => root.getPropertyValue(name) || (body ? body.getPropertyValue(name) : ''),
  )
}
