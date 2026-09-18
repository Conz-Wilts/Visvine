'use client';

import { forwardRef, useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';

/**
 * The one searchable menu: a hairline panel that floats, a bare search field
 * across its top with a hairline under it, then rows that light on hover and
 * under the arrow keys. The `[[` link picker, the note's Type and Tags, and the
 * Grid's Type and Tag filters are all this shape, so choosing from a list
 * reads the same wherever the list is.
 *
 * Pieces rather than one component because the rows differ — a tree, chips,
 * chips with counts — while the frame, the field and the cursor must not.
 */

/** The floating panel. Position it with your own `absolute …` classes. */
export const SEARCH_MENU_PANEL =
  'z-50 overflow-hidden rounded-xl border border-border-subtle bg-surface-1 shadow-float';

/** A row's box. Pair with `searchMenuRowState(active)`. */
export const SEARCH_MENU_ROW = 'flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm transition-colors';

export function searchMenuRowState(active: boolean): string {
  return active ? 'bg-surface-2' : 'hover:bg-surface-2';
}

export const SearchMenuInput = forwardRef<
  HTMLInputElement,
  {
    value: string;
    onChange: (value: string) => void;
    onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
    placeholder?: string;
    maxLength?: number;
    /** Focus on mount. On by default — a menu opens to be typed into. */
    autoFocus?: boolean;
    /** Sits at the field's right end, on the same line — a Clear, say. */
    trailing?: React.ReactNode;
  }
>(function SearchMenuInput({ value, onChange, onKeyDown, placeholder, maxLength, autoFocus = true, trailing }, ref) {
  return (
    <div className="flex items-center gap-2 border-b border-border-subtle pr-4">
      <input
        ref={ref}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        maxLength={maxLength}
        className="min-w-0 flex-1 bg-transparent py-2.5 pl-4 text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
      />
      {trailing}
    </div>
  );
});

/** The scrolling body. Rows marked `data-menu-row={i}` are kept in view as
 *  the cursor moves. */
export function SearchMenuList({ active, className, children }: {
  active?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active === undefined) return;
    ref.current?.querySelector<HTMLElement>(`[data-menu-row="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  return (
    <div
      ref={ref}
      className={clsx('max-h-80 overflow-y-auto overscroll-contain py-1 custom-scrollbar', className)}
    >
      {children}
    </div>
  );
}

export function SearchMenuEmpty({ children = 'No matches' }: { children?: React.ReactNode }) {
  return <div className="px-4 py-6 text-center text-sm text-text-muted">{children}</div>;
}

/**
 * The cursor over `count` rows: ↑/↓ move it, Enter chooses, Escape closes.
 * It returns to the top whenever `resetKey` (the query) changes.
 */
export function useSearchMenuCursor({ count, resetKey, onChoose, onClose }: {
  count: number;
  resetKey: string;
  onChoose: (index: number) => void;
  onClose: () => void;
}) {
  const [cursor, setCursor] = useState({ key: resetKey, index: 0 });
  const index = cursor.key === resetKey ? Math.min(cursor.index, Math.max(count - 1, 0)) : 0;
  const setActive = (i: number) => setCursor({ key: resetKey, index: i });

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(index + 1, count - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(index - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (count > 0) onChoose(index); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  return { active: index, setActive, onKeyDown };
}
