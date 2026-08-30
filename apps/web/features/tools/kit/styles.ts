/**
 * The kit stylesheet, as a string.
 *
 * It is a `.ts` file and not a `.css` file on purpose: the kit is compiled by
 * esbuild into a single browser ESM module with no loader chain and no
 * stylesheet request — the sandbox CSP allows `style-src 'self' 'unsafe-inline'`
 * and nothing else — so the runtime injects this once into a `<style>` tag.
 *
 * Every rule paints from a custom property and never from a literal colour, so
 * the host's theme map (which sets `--color-brand-*` and friends on `:root`)
 * repaints a Tool it has never seen. The `--vv-*` layer exists so a Tool can
 * style its own markup against a stable name even if the app's variables are
 * renamed, and the fallbacks keep it legible before the handshake lands.
 */
export const KIT_CSS = `
:root {
  --vv-accent: var(--color-brand-green, #78d870);
  --vv-accent-strong: var(--color-brand-dark-green, #2f7a3e);
  --vv-accent-soft: var(--color-brand-light-bg, #eaf9ec);
  /* The app's page backdrop (white).
     Informational: the body below stays transparent so the host's own backdrop
     shows through; paint with this only for something that must be
     self-contained, like an exported image. */
  --vv-backdrop: var(--app-backdrop, #ffffff);
  --vv-surface: var(--surface-1, #ffffff);
  --vv-surface-2: var(--surface-2, #f9fafb);
  --vv-surface-3: var(--surface-3, #f3f4f6);
  --vv-border: var(--border-subtle, #e5e7eb);
  --vv-border-strong: var(--border-default, #d1d5db);
  --vv-text: var(--text-primary, #111827);
  --vv-text-secondary: var(--text-secondary, #374151);
  --vv-text-muted: var(--text-muted, #4b5563);
  --vv-danger: #dc2626;
  --vv-danger-soft: #fef2f2;
  --vv-warn: #b45309;
  --vv-warn-soft: #fffbeb;
  --vv-info: #1d4ed8;
  --vv-info-soft: #eff6ff;
  --vv-radius: 8px;
  --vv-radius-lg: 12px;
  --vv-radius-pill: 999px;
  --vv-gap-sm: 6px;
  --vv-gap: 12px;
  --vv-gap-lg: 20px;
  --vv-font: 'Open Sauce One', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --vv-shadow: 0 8px 24px rgba(0, 0, 0, 0.06);
  /* Chart palette: accent first, then hues that stay apart in both themes.
     Resolved by useChartColors(); override any slot in your own CSS. */
  --vv-chart-1: var(--vv-accent-strong);
  --vv-chart-2: #1d4ed8;
  --vv-chart-3: #b45309;
  --vv-chart-4: #7c3aed;
  --vv-chart-5: #0e7490;
  --vv-chart-6: #be185d;
  --vv-chart-7: #4d7c0f;
  --vv-chart-8: #6b7280;
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

/* The frame is sized by the host from a ResizeObserver, so the document must
   never scroll on its own — it grows and the iframe follows. */
body { overflow-x: hidden; overflow-y: hidden; }

#root { padding: 20px; }

a { color: var(--vv-accent-strong); }

/* ── layout ── */

.vv-stack { display: flex; flex-direction: column; gap: var(--vv-gap); }
.vv-stack--row { flex-direction: row; align-items: center; }
.vv-stack--row.vv-stack--wrap { flex-wrap: wrap; }
.vv-stack--sm { gap: var(--vv-gap-sm); }
.vv-stack--lg { gap: var(--vv-gap-lg); }
.vv-stack--grow > * { min-width: 0; }

.vv-page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--vv-gap);
  margin-bottom: var(--vv-gap-lg);
}
.vv-page-header__title { margin: 0; font-size: 20px; font-weight: 600; color: var(--vv-text); }
.vv-page-header__description { margin: 4px 0 0; font-size: 13px; color: var(--vv-text-muted); }
.vv-page-header__actions { display: flex; align-items: center; gap: var(--vv-gap-sm); flex-shrink: 0; }

.vv-card {
  background: var(--vv-surface);
  border: 1px solid var(--vv-border);
  border-radius: var(--vv-radius-lg);
  padding: 16px;
}
.vv-card--flush { padding: 0; overflow: hidden; }
.vv-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--vv-gap-sm);
  margin-bottom: 12px;
}
.vv-card--flush .vv-card__header { margin: 0; padding: 12px 16px; border-bottom: 1px solid var(--vv-border); }
.vv-card__title { font-size: 14px; font-weight: 600; color: var(--vv-text); }

/* ── button ── */

.vv-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid transparent;
  border-radius: var(--vv-radius);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
  padding: 8px 14px;
  transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
}
.vv-btn--sm { padding: 5px 10px; font-size: 13px; }
.vv-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.vv-btn--primary { background: var(--vv-accent); color: #ffffff; }
.vv-btn--primary:hover:not(:disabled) { background: var(--vv-accent-strong); }
.vv-btn--secondary { background: var(--vv-surface); color: var(--vv-text); border-color: var(--vv-border-strong); }
.vv-btn--secondary:hover:not(:disabled) { background: var(--vv-surface-3); }
.vv-btn--ghost { background: transparent; color: var(--vv-text-secondary); }
.vv-btn--ghost:hover:not(:disabled) { background: var(--vv-surface-3); color: var(--vv-text); }
.vv-btn--danger { background: var(--vv-danger); color: #ffffff; }
.vv-btn--danger:hover:not(:disabled) { filter: brightness(0.92); }

/* ── form ── */

.vv-field { display: flex; flex-direction: column; gap: 4px; }
.vv-field__label { font-size: 12px; font-weight: 600; color: var(--vv-text-secondary); }
.vv-field__hint { font-size: 12px; color: var(--vv-text-muted); }
.vv-field__error { font-size: 12px; color: var(--vv-danger); }

.vv-input, .vv-select, .vv-textarea {
  width: 100%;
  font: inherit;
  color: var(--vv-text);
  background: var(--vv-surface);
  border: 1px solid var(--vv-border-strong);
  border-radius: var(--vv-radius);
  padding: 8px 10px;
}
.vv-textarea { resize: vertical; min-height: 88px; }
.vv-input:focus, .vv-select:focus, .vv-textarea:focus {
  outline: none;
  border-color: var(--vv-accent);
  box-shadow: 0 0 0 3px var(--vv-accent-soft);
}
.vv-input:disabled, .vv-select:disabled, .vv-textarea:disabled { background: var(--vv-surface-3); cursor: not-allowed; }
.vv-input::placeholder, .vv-textarea::placeholder { color: var(--vv-text-muted); }

/* ── chip ── */

.vv-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: var(--vv-radius-pill);
  padding: 2px 10px;
  font-size: 12px;
  font-weight: 500;
  background: var(--vv-surface-3);
  color: var(--vv-text-secondary);
}
.vv-chip--accent { background: var(--vv-accent-soft); color: var(--vv-accent-strong); }
.vv-chip--danger { background: var(--vv-danger-soft); color: var(--vv-danger); }
.vv-chip--warn { background: var(--vv-warn-soft); color: var(--vv-warn); }
.vv-chip--info { background: var(--vv-info-soft); color: var(--vv-info); }

/* ── tabs ── */

.vv-tabs { display: flex; align-items: center; gap: 4px; border-bottom: 1px solid var(--vv-border); }
.vv-tab {
  border: 0;
  background: transparent;
  font: inherit;
  font-weight: 500;
  color: var(--vv-text-muted);
  cursor: pointer;
  padding: 8px 12px;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.vv-tab:hover { color: var(--vv-text); }
.vv-tab--active { color: var(--vv-text); border-bottom-color: var(--vv-accent); }

/* ── table ── */

.vv-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.vv-table th {
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--vv-text-muted);
  padding: 8px 12px;
  border-bottom: 1px solid var(--vv-border);
}
.vv-table td { padding: 10px 12px; border-bottom: 1px solid var(--vv-border); color: var(--vv-text); vertical-align: top; }
.vv-table tr:last-child td { border-bottom: 0; }
.vv-table__cell--right { text-align: right; }
.vv-table__row--clickable { cursor: pointer; }
.vv-table__row--clickable:hover td { background: var(--vv-surface-2); }

/* ── data table ── */

.vv-datatable__wrap { width: 100%; }
.vv-datatable__wrap--scroll { overflow: auto; }
.vv-datatable--sticky thead th { position: sticky; top: 0; z-index: 1; background: var(--vv-surface); }
.vv-datatable__th--sortable { padding: 0; }
.vv-datatable__sort {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--vv-text-muted);
  text-align: inherit;
  cursor: pointer;
  padding: 8px 12px;
}
.vv-table__cell--right .vv-datatable__sort { justify-content: flex-end; }
.vv-datatable__sort:hover { color: var(--vv-text); }
.vv-datatable__arrow { font-size: 9px; opacity: 0.35; }
.vv-datatable__arrow--asc, .vv-datatable__arrow--desc { opacity: 1; color: var(--vv-accent-strong); }
.vv-datatable__spacer td { padding: 0; border: 0; }

/* ── charts ── */

.vv-chart { width: 100%; min-width: 0; color: var(--vv-text-muted); font-size: 11px; }
.vv-chart .recharts-legend-item-text { color: var(--vv-text-secondary) !important; }
.vv-chart .recharts-default-tooltip { box-shadow: var(--vv-shadow); }

/* ── date picker ── */

.vv-datepicker { width: auto; min-width: 160px; }
.vv-datepicker::-webkit-calendar-picker-indicator { cursor: pointer; opacity: 0.6; }

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

/* ── kanban ── */

.vv-kanban { display: flex; gap: var(--vv-gap); align-items: flex-start; overflow-x: auto; padding-bottom: 4px; }
.vv-kanban--dragging { cursor: grabbing; user-select: none; }
.vv-kanban__column {
  flex: 0 0 260px;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  background: var(--vv-surface-2);
  border: 1px solid var(--vv-border);
  border-radius: var(--vv-radius-lg);
  max-height: 100%;
}
.vv-kanban__column--over { border-color: var(--vv-accent); background: var(--vv-accent-soft); }
.vv-kanban__column-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--vv-gap-sm);
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--vv-text);
}
.vv-kanban__column-title { display: inline-flex; align-items: center; gap: 6px; }
.vv-kanban__count { font-size: 11px; font-weight: 600; color: var(--vv-text-muted); background: var(--vv-surface-3); border-radius: var(--vv-radius-pill); padding: 0 7px; }
.vv-kanban__cards { display: flex; flex-direction: column; gap: 8px; padding: 0 8px 8px; min-height: 40px; }
.vv-kanban__card {
  background: var(--vv-surface);
  border: 1px solid var(--vv-border);
  border-radius: var(--vv-radius);
  padding: 10px 12px;
  font-size: 13px;
  color: var(--vv-text);
  cursor: grab;
}
.vv-kanban__card--clickable:hover { border-color: var(--vv-border-strong); }
.vv-kanban__card--dragging { opacity: 0.35; }
.vv-kanban__card--ghost { opacity: 0.95; box-shadow: var(--vv-shadow); transform: rotate(1.5deg); cursor: grabbing; }
.vv-kanban__empty { font-size: 12px; color: var(--vv-text-muted); text-align: center; padding: 12px 8px; border: 1px dashed var(--vv-border-strong); border-radius: var(--vv-radius); }

/* ── feedback ── */

.vv-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  text-align: center;
  padding: 40px 20px;
  color: var(--vv-text-muted);
}
.vv-empty__title { font-size: 14px; font-weight: 600; color: var(--vv-text-secondary); }
.vv-empty__description { font-size: 13px; max-width: 42ch; }

.vv-banner {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--vv-gap);
  border-radius: var(--vv-radius);
  padding: 10px 14px;
  font-size: 13px;
  border: 1px solid transparent;
}
.vv-banner--info { background: var(--vv-info-soft); color: var(--vv-info); }
.vv-banner--success { background: var(--vv-accent-soft); color: var(--vv-accent-strong); }
.vv-banner--warn { background: var(--vv-warn-soft); color: var(--vv-warn); }
.vv-banner--danger { background: var(--vv-danger-soft); color: var(--vv-danger); }
.vv-banner__title { font-weight: 600; }

.vv-spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid var(--vv-border-strong);
  border-top-color: var(--vv-accent);
  border-radius: 50%;
  animation: vv-spin 700ms linear infinite;
}
.vv-spinner--lg { width: 24px; height: 24px; border-width: 3px; }

@keyframes vv-spin { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
  .vv-spinner { animation-duration: 2s; }
  .vv-btn { transition: none; }
}
`;
