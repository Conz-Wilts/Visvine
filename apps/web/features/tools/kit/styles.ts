import { color, fontFamily, palette, radius } from '@visvine/tokens';

/**
 * The stylesheets the kit's runtime injects, as strings — the frame's base for
 * every Tool, and kit 1's component rules for a Tool written for it. Kit 2's
 * components are the app's own and paint from the compiled stylesheet the
 * frame document links instead (`tool-kit.css`).
 *
 * Every rule paints from a custom property and never from a literal colour, so
 * the host's theme map (which sets `--color-brand-*` and friends on `:root`)
 * repaints a Tool it has never seen. The `--vv-*` layer exists so a Tool can
 * style its own markup against a stable name even if the app's variables are
 * renamed, and the fallbacks keep it legible before the handshake lands. Every
 * value here is a design token (packages/tokens), interpolated at build time.
 */

/** The chart series, accent first, then hues that stay apart. `--vv-chart-1`
 *  follows the host's accent; these are the values before the handshake lands. */
export const CHART_COLORS: string[] = [
  color.accent.strong,
  palette.blue[700],
  palette.amber[700],
  palette.violet[600],
  palette.cyan[700],
  palette.pink[700],
  palette.lime[700],
  palette.gray[500],
];

/**
 * What every Tool frame starts from: the `--vv-*` layer, the transparent page,
 * the frame's own padding and type, and rendered markdown. Kit 2's components
 * paint from the compiled stylesheet the frame links (lib/tools/vendorBundle.ts,
 * `tool-kit.css`), so this is all the runtime injects for them.
 */
export const BASE_CSS = `
:root {
  --vv-accent: var(--color-brand-green, ${color.accent.default});
  --vv-accent-strong: var(--color-brand-dark-green, ${color.accent.strong});
  --vv-accent-soft: var(--color-brand-light-bg, ${color.accent.soft});
  /* The app's page backdrop (white).
     Informational: the body below stays transparent so the host's own backdrop
     shows through; paint with this only for something that must be
     self-contained, like an exported image. */
  --vv-backdrop: var(--app-backdrop, ${color.surface.backdrop});
  --vv-surface: var(--surface-1, ${color.surface.default});
  --vv-surface-2: var(--surface-2, ${color.surface.subtle});
  --vv-surface-3: var(--surface-3, ${color.surface.muted});
  --vv-border: var(--border-subtle, ${color.line.subtle});
  --vv-border-strong: var(--border-default, ${color.line.default});
  --vv-text: var(--text-primary, ${color.fg.default});
  --vv-text-secondary: var(--text-secondary, ${color.fg.secondary});
  --vv-text-muted: var(--text-muted, ${color.fg.muted});
  --vv-danger: ${color.danger.default};
  --vv-danger-soft: ${color.danger.wash};
  --vv-warn: ${color.warning.default};
  --vv-warn-soft: ${color.warning.wash};
  --vv-info: ${color.info.default};
  --vv-info-soft: ${color.info.wash};
  --vv-radius: ${radius.lg}px;
  --vv-radius-lg: ${radius.xl}px;
  --vv-radius-pill: 999px;
  --vv-gap-sm: 6px;
  --vv-gap: 12px;
  --vv-gap-lg: 20px;
  --vv-font: ${fontFamily.ui};
  --vv-shadow: 0 8px 24px rgba(0, 0, 0, 0.06);
  /* Chart palette: accent first, then hues that stay apart in both themes.
     Resolved by useChartColors(); override any slot in your own CSS. */
  --vv-chart-1: var(--vv-accent-strong);
  --vv-chart-2: ${CHART_COLORS[1]};
  --vv-chart-3: ${CHART_COLORS[2]};
  --vv-chart-4: ${CHART_COLORS[3]};
  --vv-chart-5: ${CHART_COLORS[4]};
  --vv-chart-6: ${CHART_COLORS[5]};
  --vv-chart-7: ${CHART_COLORS[6]};
  --vv-chart-8: ${CHART_COLORS[7]};
}

*, *::before, *::after { box-sizing: border-box; }

/* Transparent on purpose: the host's backdrop shows through the frame, so a
   Tool sits on the same canvas as every native page. A Tool must never repaint
   html/body/#root. */
html, body {
  margin: 0;
  padding: 0;
  background: transparent;
  color: var(--vv-text);
  font-family: var(--vv-font);
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

/* The host grows the frame to the Tool's height, up to the pane; past that the
   document scrolls inside the frame, as any page taller than its window does. */
body { overflow-x: hidden; overflow-y: auto; }

#root { padding: 20px; }

a { color: var(--vv-accent-strong); }

/* ── charts ── */

.vv-chart { width: 100%; min-width: 0; color: var(--vv-text-muted); font-size: 11px; }
.vv-chart .recharts-legend-item-text { color: var(--vv-text-secondary) !important; }
.vv-chart .recharts-default-tooltip { box-shadow: var(--vv-shadow); }

/* ── markdown ── */

.vv-md { font-size: 14px; line-height: 1.6; color: var(--vv-text-secondary); overflow-wrap: anywhere; }
.vv-md > :first-child { margin-top: 0; }
.vv-md > :last-child { margin-bottom: 0; }
.vv-md h1, .vv-md h2, .vv-md h3, .vv-md h4, .vv-md h5, .vv-md h6 { color: var(--vv-text); font-weight: 600; margin: 1.2em 0 0.4em; line-height: 1.3; }
.vv-md h1 { font-size: 20px; }
.vv-md h2 { font-size: 17px; }
.vv-md h3 { font-size: 15px; }
.vv-md h4, .vv-md h5, .vv-md h6 { font-size: 14px; }
.vv-md p, .vv-md ul, .vv-md ol, .vv-md blockquote, .vv-md pre { margin: 0.6em 0; }
.vv-md ul, .vv-md ol { padding-left: 1.4em; }
.vv-md ul { list-style: disc; }
.vv-md ol { list-style: decimal; }
.vv-md li + li { margin-top: 0.2em; }
.vv-md li.task-list-item { list-style: none; margin-left: -1.4em; }
.vv-md a, .vv-md__link { color: var(--vv-accent-strong); text-decoration: underline; cursor: pointer; }
.vv-md strong { color: var(--vv-text); font-weight: 600; }
.vv-md code { font: 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--vv-surface-3); border-radius: 4px; padding: 1px 5px; color: var(--vv-text); }
.vv-md pre { background: var(--vv-surface-3); border-radius: var(--vv-radius); padding: 10px 12px; overflow-x: auto; }
.vv-md pre code { background: transparent; padding: 0; }
.vv-md blockquote { border-left: 3px solid var(--vv-border-strong); padding-left: 12px; color: var(--vv-text-muted); }
.vv-md hr { border: 0; border-top: 1px solid var(--vv-border); margin: 1.2em 0; }
.vv-md__table-wrap { overflow-x: auto; margin: 0.6em 0; }

`;
