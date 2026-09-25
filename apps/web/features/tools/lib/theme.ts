/**
 * The theme the host hands a Tool at handshake time.
 *
 * A Tool renders in a sandboxed iframe on another origin: it cannot see the
 * app's stylesheet, and it must not be able to. So the host reads the custom
 * properties the app is *currently painted with* — including whatever accent
 * ThemeContext wrote onto `:root` a moment ago — and posts them across as a flat
 * map, which the frame runtime sets back onto its own `:root`. That is the whole
 * mechanism behind "installed Tools don't look like twelve different
 * websites".
 *
 * Every token goes over twice: under the name the app's variable had when the
 * contract was written (`--color-brand-green`, `--text-muted`), because a Tool
 * author may reference those directly, and under a stable `--vv-*` alias the
 * kit's stylesheet is written against (features/tools/kit/styles.ts). Both are
 * the contract. The app itself now paints with the design tokens
 * (`--vv-color-accent`, `--vv-color-fg-muted`) and this map is what keeps an
 * installed Tool pinned to an old version painting right.
 *
 * The computed values are read behind a plain `(name) => string` reader so the
 * mapping itself is pure and testable without a DOM.
 */

import { color, fontFamily } from '@visvine/tokens'

/**
 * What the host reads (the design token it paints with) → the legacy app name
 * a Tool may reference → the `--vv-*` alias the kit stylesheet is written
 * against → the value used when nothing is painted (server render, or a Tool
 * previewed outside the themed shell). The legacy names are what the app's
 * variables were called when the Tool contract was written; they go over
 * unchanged so a Tool that reads them keeps painting right. The fallbacks are
 * the tokens themselves, so a missing value is never an unstyled Tool.
 */
const THEME_TOKENS: ReadonlyArray<readonly [read: string, legacy: string, alias: string, fallback: string]> = [
  // Accent — the one token a person actually changes (ThemeContext#applyAll).
  ['--vv-color-accent', '--color-brand-green', '--vv-accent', color.accent.default],
  ['--vv-color-accent-strong', '--color-brand-dark-green', '--vv-accent-strong', color.accent.strong],
  ['--vv-color-accent-soft', '--color-brand-light-bg', '--vv-accent-soft', color.accent.soft],
  // The page backdrop — plain white. A Tool
  // rarely paints this itself (the frame is transparent, so the app's own
  // backdrop already shows through); it goes over so a Tool that must know
  // the value (a canvas, an exported image) reads the real one.
  ['--vv-color-surface-backdrop', '--app-backdrop', '--vv-backdrop', color.surface.backdrop],
  // Surfaces and borders.
  ['--vv-color-surface', '--surface-1', '--vv-surface', color.surface.default],
  ['--vv-color-surface-subtle', '--surface-2', '--vv-surface-2', color.surface.subtle],
  ['--vv-color-surface-muted', '--surface-3', '--vv-surface-3', color.surface.muted],
  ['--vv-color-line-subtle', '--border-subtle', '--vv-border', color.line.subtle],
  ['--vv-color-line', '--border-default', '--vv-border-strong', color.line.default],
  // Text.
  ['--vv-color-fg', '--text-primary', '--vv-text', color.fg.default],
  ['--vv-color-fg-secondary', '--text-secondary', '--vv-text-secondary', color.fg.secondary],
  ['--vv-color-fg-muted', '--text-muted', '--vv-text-muted', color.fg.muted],
  // Type. `--font-utility` is the product's body face; the brand face is
  // marketing-only (app/globals.css) and is deliberately not published.
  ['--font-utility', '--font-utility', '--vv-font', fontFamily.ui],
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
  for (const [source, legacy, alias, fallback] of THEME_TOKENS) {
    const raw = read(source).trim()
    const value = raw || fallback
    tokens[legacy] = value
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
