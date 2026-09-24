'use client';

import { clsx } from 'clsx';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { FOCUS_RING } from './focus';

export interface MenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  /** A destructive action: drawn in the danger ink, last. */
  danger?: boolean;
  disabled?: boolean;
}

/**
 * A small popover of actions under a trigger — the overflow (…) of a toolbar.
 * Opens on click, closes on a choice, a click outside or Escape; the arrow
 * keys move through its items. Floats, so it casts the float shadow.
 */
export default function Menu({
  trigger,
  items,
  align = 'end',
  placement = 'below',
  label,
}: {
  /** Renders the button; receives whether the menu is open and the toggle. */
  trigger: (props: { open: boolean; toggle: () => void; id: string }) => ReactNode;
  items: MenuItem[];
  align?: 'start' | 'end';
  placement?: 'below' | 'above';
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const enabled = items.filter((item) => !item.disabled);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => (c + (e.key === 'ArrowDown' ? 1 : -1) + enabled.length) % Math.max(enabled.length, 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = enabled[cursor];
        if (item) {
          setOpen(false);
          item.onSelect();
        }
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, cursor, enabled]);

  return (
    <div ref={root} className="relative">
      {trigger({
        open,
        id,
        toggle: () => {
          setCursor(0);
          setOpen((o) => !o);
        },
      })}
      {open && (
        <div
          role="menu"
          aria-label={label}
          id={id}
          className={clsx(
            'absolute z-(--vv-z-popover) min-w-44 rounded-xl border border-line-subtle bg-surface p-1 shadow-float',
            align === 'end' ? 'right-0' : 'left-0',
            placement === 'below' ? 'top-full mt-1' : 'bottom-full mb-1',
          )}
        >
          {items.map((item) => {
            const at = enabled.indexOf(item);
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onMouseEnter={() => at >= 0 && setCursor(at)}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className={clsx(
                  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors disabled:opacity-40 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0',
                  item.danger ? 'text-danger' : 'text-fg-secondary',
                  at === cursor && !item.disabled && 'bg-surface-subtle text-fg',
                  FOCUS_RING,
                )}
              >
                {item.icon}
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
