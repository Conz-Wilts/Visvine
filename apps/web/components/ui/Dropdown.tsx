'use client';

// Shared dropdown sizing — import these when building a dropdown (single- or
// multi-select, search, etc.) so trigger/menu/items stay in sync site-wide.
//
// The trigger is a text button — chevron, label, value — with no border and no
// fill at rest: it reads as a word you can change, not a box on the toolbar.
// Only the menu floats, and it is the one part that carries a shadow — the
// menu itself is SearchMenu.tsx.
/** Toolbar-sized trigger — sits on one line beside a 40px search field. */
export const DROPDOWN_TRIGGER_CLASS =
  'flex h-10 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold transition-colors hover:bg-surface-3';
/** A filter is applied: the trigger speaks in the accent's dark shade. */
export const DROPDOWN_TRIGGER_ACTIVE_STYLE: React.CSSProperties = {
  color: 'var(--color-brand-dark-green)',
};
export const DROPDOWN_TRIGGER_IDLE_STYLE: React.CSSProperties = {
  color: 'var(--text-primary, #111827)',
};
