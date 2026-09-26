/**
 * `DatePicker` — a field-shaped trigger showing the date as a person reads it
 * ("12 Oct 2026"), opening a small month the app draws itself: never the
 * browser's own `dd/mm/yyyy` control, which looks different in every browser
 * and nothing like the rest of a Tool. Values are ISO calendar dates
 * (`YYYY-MM-DD`) or null, never a `Date`: a Tool almost always stores the
 * string, and a `Date` would drag a timezone into a field that has none.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { clsx } from 'clsx';
import { inputBaseClass, SEARCH_MENU_PANEL } from '@visvine/ui';

export interface DatePickerProps {
  /** `YYYY-MM-DD`, or null for empty. */
  value: string | null;
  onChange: (value: string | null) => void;
  /** `YYYY-MM-DD` bounds. */
  min?: string;
  max?: string;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  /** `sm` is a toolbar's height. */
  size?: 'sm' | 'md';
  className?: string;
  style?: CSSProperties;
  'aria-label'?: string;
}

/** About how tall the month popover is. */
const MONTH_HEIGHT = 340;

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateOf = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function DatePicker({ value, onChange, min, max, id, placeholder = 'Pick a date', disabled, size = 'md', className, style, ...aria }: DatePickerProps) {
  const chosen = dateOf(value);
  const [open, setOpen] = useState(false);
  const [upward, setUpward] = useState(false);
  const [month, setMonth] = useState(() => {
    const d = chosen ?? new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const days = useMemo(() => {
    const offset = (month.getDay() + 6) % 7;
    const start = new Date(month.getFullYear(), month.getMonth(), 1 - offset);
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [month]);
  const today = isoOf(new Date());
  const names = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

  const pick = (iso: string) => {
    onChange(iso);
    setOpen(false);
  };
  const out = (iso: string) => (min !== undefined && iso < min) || (max !== undefined && iso > max);

  return (
    <div ref={rootRef} className={clsx('relative', className)} style={style}>
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        {...aria}
        onClick={() => {
          if (!open) {
            const d = chosen ?? new Date();
            setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
            // Open upward when the frame has no room for the month below.
            const rect = rootRef.current?.getBoundingClientRect();
            setUpward(Boolean(rect && rect.bottom + MONTH_HEIGHT > window.innerHeight && rect.top > MONTH_HEIGHT));
          }
          setOpen(!open);
        }}
        className={clsx(inputBaseClass, 'flex items-center gap-2 text-left', size === 'sm' && 'h-9 py-0 pl-3 text-sm')}
      >
        <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-fg-muted" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2" />
        </svg>
        <span className={clsx('min-w-0 flex-1 truncate', !chosen && 'text-fg-muted')}>
          {chosen ? chosen.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : placeholder}
        </span>
        {chosen && !disabled && (
          <span
            role="button"
            aria-label="Clear date"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
            }}
            className="rounded p-0.5 text-fg-muted hover:bg-surface-muted hover:text-fg"
          >
            <svg aria-hidden viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label="Choose a date" className={clsx(SEARCH_MENU_PANEL, 'absolute left-0 z-20 w-72 p-3', upward ? 'bottom-full mb-1' : 'top-full mt-1')}>
          <div className="mb-2 flex items-center justify-between">
            <button type="button" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded-md p-1.5 text-fg-muted hover:bg-surface-subtle hover:text-fg">
              <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <span className="text-sm font-semibold text-fg">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
            <button type="button" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded-md p-1.5 text-fg-muted hover:bg-surface-subtle hover:text-fg">
              <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {names.map((n) => (
              <span key={n} className="py-1 text-xs font-medium text-fg-muted">
                {n}
              </span>
            ))}
            {days.map((d) => {
              const iso = isoOf(d);
              const inMonth = d.getMonth() === month.getMonth();
              const selected = value?.slice(0, 10) === iso;
              return (
                <button
                  key={iso}
                  type="button"
                  disabled={out(iso)}
                  onClick={() => pick(iso)}
                  aria-pressed={selected}
                  className={clsx(
                    'h-8 rounded-md text-sm tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                    selected ? 'bg-accent-strong font-semibold text-fg-inverse' : iso === today ? 'font-semibold text-accent-strong hover:bg-surface-subtle' : inMonth ? 'text-fg hover:bg-surface-subtle' : 'text-fg-subtle hover:bg-surface-subtle',
                  )}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between border-t border-line-subtle pt-2">
            <button type="button" onClick={() => pick(today)} className="rounded-md px-2 py-1 text-sm text-fg-secondary hover:bg-surface-subtle hover:text-fg">
              Today
            </button>
            {value && (
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                className="rounded-md px-2 py-1 text-sm text-fg-muted hover:bg-surface-subtle hover:text-fg"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
