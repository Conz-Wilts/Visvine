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
  --vv-surface: var(--surface-1, #ffffff);
  --vv-surface-2: var(--surface-2, #f9fafb);
  --vv-surface-3: var(--surface-3, #f3f4f6);
  --vv-border: var(--border-subtle, #e5e7eb);
  --vv-border-strong: var(--border-default, #d1d5db);
  --vv-text: var(--text-primary, #111827);
  --vv-text-secondary: var(--text-secondary, #374151);
  --vv-text-muted: var(--text-muted, #6b7280);
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
}

*, *::before, *::after { box-sizing: border-box; }

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
