import { color } from '@visvine/tokens';
import { BASE_CSS } from '../styles';

/**
 * Kit 1's component rules — `vv-btn`, `vv-card` and the rest — frozen with
 * the components that use them (features/tools/kit/legacy), so a Tool written
 * for `sdk: ^1` renders exactly as it did.
 */
const LEGACY_CSS = `
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
.vv-btn--primary { background: var(--vv-accent); color: ${color.fg.inverse}; }
.vv-btn--primary:hover:not(:disabled) { background: var(--vv-accent-strong); }
.vv-btn--secondary { background: var(--vv-surface); color: var(--vv-text); border-color: var(--vv-border-strong); }
.vv-btn--secondary:hover:not(:disabled) { background: var(--vv-surface-3); }
.vv-btn--ghost { background: transparent; color: var(--vv-text-secondary); }
.vv-btn--ghost:hover:not(:disabled) { background: var(--vv-surface-3); color: var(--vv-text); }
.vv-btn--danger { background: var(--vv-danger); color: ${color.fg.inverse}; }
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

/* ── date picker ── */

.vv-datepicker { width: auto; min-width: 160px; }
.vv-datepicker::-webkit-calendar-picker-indicator { cursor: pointer; opacity: 0.6; }

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

/** Kit 1's whole stylesheet. */
export const KIT_CSS = BASE_CSS + LEGACY_CSS;

