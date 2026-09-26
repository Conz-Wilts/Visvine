/**
 * Page blocks — the layouts a Tool's page is made of, so an author arranges
 * blocks instead of inventing a layout: the toolbar over a list (`Toolbar`),
 * a row of numbers (`StatRow`, `Stat`), a list beside the thing it opens
 * (`ListDetail`), a month (`MonthCalendar`), progress (`Progress`), and the
 * page's own gutter (`Page`). Each is flat — hairlines, never a boxed card —
 * and draws its own empty state.
 */
import { Children, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { Segmented } from './Segmented';
import { HueDot } from './records';
import type { Hue } from './records';

// ── the page ──

export interface PageProps {
  children: ReactNode;
  /** `wide` fills the pane; `normal` keeps reading width on a very wide one. */
  width?: 'wide' | 'normal';
  className?: string;
}

/** The Tool's page: the app's gutter, a steady vertical rhythm between blocks. */
export function Page({ children, width = 'wide', className }: PageProps) {
  return <div className={clsx('flex flex-col gap-6 px-6 py-5', width === 'normal' && 'max-w-5xl', className)}>{children}</div>;
}

// ── the toolbar ──

export interface ToolbarView {
  value: string;
  label: string;
}

export interface ToolbarProps {
  search?: string;
  onSearch?: (value: string) => void;
  searchPlaceholder?: string;
  /** Two to four ways to look at the same rows (Board · Table). */
  views?: ToolbarView[];
  view?: string;
  onView?: (value: string) => void;
  /** Filters — usually Selects — between the search and the view switch. */
  filters?: ReactNode;
  /** The primary action, at the right end. */
  actions?: ReactNode;
  className?: string;
}

/** One row over a list: search · filters · view switch · the primary action. */
export function Toolbar({ search, onSearch, searchPlaceholder = 'Search', views, view, onView, filters, actions, className }: ToolbarProps) {
  return (
    <div className={clsx('flex flex-wrap items-center gap-2', className)}>
      {onSearch && (
        <label className="flex h-9 w-full items-center gap-2 rounded-lg bg-surface-subtle px-3 text-fg-muted transition-colors focus-within:bg-surface focus-within:ring-1 focus-within:ring-line sm:w-64">
          <Icon name="search" size={15} />
          <input
            type="search"
            value={search ?? ''}
            onChange={(e) => onSearch(e.currentTarget.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-muted"
          />
        </label>
      )}
      {filters}
      <div className="ml-auto flex items-center gap-2">
        {views && views.length > 1 && onView && <Segmented label="View" options={views} value={view ?? views[0].value} onChange={onView} />}
        {actions}
      </div>
    </div>
  );
}

// ── numbers ──

export interface StatProps {
  label: ReactNode;
  value: ReactNode;
  /** A change beside it: positive reads as good unless `invert`. */
  delta?: number;
  deltaLabel?: ReactNode;
  invert?: boolean;
  icon?: IconName;
  /** A line under the value — "of 40 seats", "3 overdue". */
  hint?: ReactNode;
  /** The number that matters most on the page: drawn larger. One per row. */
  lead?: boolean;
  /** `danger` when the number is a problem (overdue, blocked) and above zero. */
  tone?: 'danger' | 'success';
  /** Pressing it filters to what it counts. */
  onClick?: () => void;
  /** The filter it applies is on. */
  active?: boolean;
}

const STAT_TONE = { danger: 'text-danger', success: 'text-success' } as const;

/** One number over its label. */
export function Stat({ label, value, delta, deltaLabel, invert = false, icon, hint, lead = false, tone, onClick, active = false }: StatProps) {
  const good = delta === undefined ? null : invert ? delta < 0 : delta > 0;
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-fg-muted">
        {icon && <Icon name={icon} size={14} />}
        <span className="truncate">{label}</span>
      </span>
      <span className="flex items-baseline gap-2">
        <span className={clsx('font-semibold tabular-nums', lead ? 'text-3xl' : 'text-2xl', tone ? STAT_TONE[tone] : 'text-fg')}>{value}</span>
        {delta !== undefined && delta !== 0 && (
          <span className={clsx('inline-flex items-center gap-0.5 text-xs font-medium tabular-nums', good ? 'text-success' : 'text-danger')}>
            <Icon name={delta > 0 ? 'arrowUp' : 'arrowDown'} size={12} />
            {deltaLabel ?? Math.abs(delta)}
          </span>
        )}
      </span>
      {hint && <span className="truncate text-xs text-fg-muted">{hint}</span>}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={clsx('-m-2 flex min-w-0 flex-col gap-1 rounded-lg p-2 text-left transition-colors hover:bg-surface-subtle', active && 'bg-surface-subtle ring-1 ring-line')}
      >
        {body}
      </button>
    );
  }
  return <div className="flex min-w-0 flex-col gap-1">{body}</div>;
}

/** Literal classes, one per count (the stylesheet is compiled from this file). */
const STAT_COLS: Record<number, string> = { 1: 'md:grid-cols-1', 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-4', 5: 'md:grid-cols-5' };

/** Two to five Stats in a row over a hairline, as many columns as there are stats, stacking when narrow. */
export function StatRow({ children, className }: { children: ReactNode; className?: string }) {
  const count = Math.min(5, Math.max(1, Children.toArray(children).length));
  return (
    <div className={clsx('grid grid-cols-2 gap-x-6 gap-y-4 border-b border-line-subtle pb-5', STAT_COLS[count], className)}>
      {children}
    </div>
  );
}

// ── progress ──

export interface ProgressProps {
  /** 0–1, or `value` of `max`. */
  value: number;
  max?: number;
  hue?: Hue;
  label?: ReactNode;
  className?: string;
}

const BAR: Record<Hue, string> = {
  gray: 'bg-hue-gray',
  red: 'bg-hue-red',
  orange: 'bg-hue-orange',
  amber: 'bg-hue-amber',
  yellow: 'bg-hue-yellow',
  green: 'bg-hue-green',
  teal: 'bg-hue-teal',
  cyan: 'bg-hue-cyan',
  sky: 'bg-hue-sky',
  blue: 'bg-hue-blue',
  indigo: 'bg-hue-indigo',
  violet: 'bg-hue-violet',
  pink: 'bg-hue-pink',
};

/** A thin bar, filled to a share. */
export function Progress({ value, max = 1, hue = 'blue', label, className }: ProgressProps) {
  const share = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      {label && (
        <div className="flex justify-between text-xs text-fg-muted">
          <span className="truncate">{label}</span>
          <span className="tabular-nums">{Math.round(share * 100)}%</span>
        </div>
      )}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
        <div className={clsx('h-full rounded-full transition-all', BAR[hue])} style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  );
}

// ── a list beside what it opens ──

export interface ListDetailProps<T> {
  items: T[];
  itemKey: (item: T) => string;
  selected: string | null;
  onSelect: (key: string) => void;
  renderItem: (item: T, selected: boolean) => ReactNode;
  /** The selected item's page. */
  detail: ReactNode;
  /** Above the list — a search, a count. */
  listHeader?: ReactNode;
  /** In place of the list when there are no items. */
  empty?: ReactNode;
  /** When nothing is selected. */
  placeholder?: ReactNode;
}

/**
 * A list on the left and the chosen item on the right, divided by a hairline;
 * on a narrow frame the list stacks above.
 */
export function ListDetail<T>({ items, itemKey, selected, onSelect, renderItem, detail, listHeader, empty, placeholder }: ListDetailProps<T>) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-12 md:divide-x md:divide-line-subtle">
      <div className="flex min-w-0 flex-col md:col-span-4 md:pr-4">
        {listHeader && <div className="pb-3">{listHeader}</div>}
        {items.length === 0 ? (
          (empty ?? <p className="py-8 text-center text-sm text-fg-muted">Nothing here yet.</p>)
        ) : (
          <ul className="flex flex-col">
            {items.map((item) => {
              const key = itemKey(item);
              const on = key === selected;
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => onSelect(key)}
                    aria-current={on || undefined}
                    className={clsx('w-full rounded-md px-3 py-2.5 text-left transition-colors', on ? 'bg-accent-soft' : 'hover:bg-surface-subtle')}
                  >
                    {renderItem(item, on)}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="min-w-0 pt-6 md:col-span-8 md:pl-6 md:pt-0">
        {selected ? detail : (placeholder ?? <p className="py-8 text-center text-sm text-fg-muted">Pick one on the left.</p>)}
      </div>
    </div>
  );
}

// ── a month ──

export interface CalendarItem {
  id: string;
  /** `YYYY-MM-DD`. */
  date: string;
  title: ReactNode;
  hue?: Hue;
}

export interface MonthCalendarProps {
  /** Any day in the month shown, `YYYY-MM-DD`. */
  month: string;
  onMonth: (month: string) => void;
  items: CalendarItem[];
  onOpen?: (id: string) => void;
  /** Pressing an empty part of a day — to add something on it. */
  onDay?: (date: string) => void;
  /** First day of the week: 1 = Monday (default), 0 = Sunday. */
  weekStart?: 0 | 1;
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Today as `YYYY-MM-DD`, in the viewer's time. */
export function todayIso(): string {
  return iso(new Date());
}

/** A month grid with each day's items as chips; ‹ › step the month. */
export function MonthCalendar({ month, onMonth, items, onOpen, onDay, weekStart = 1 }: MonthCalendarProps) {
  const [expandedDays, setExpandedDays] = useState<Set<string>>(() => new Set());
  const first = useMemo(() => {
    const d = new Date(`${month.slice(0, 7)}-01T00:00:00`);
    return Number.isNaN(d.getTime()) ? new Date(new Date().getFullYear(), new Date().getMonth(), 1) : d;
  }, [month]);
  const days = useMemo(() => {
    const offset = (first.getDay() - weekStart + 7) % 7;
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
    const weeks = Math.ceil((offset + new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()) / 7);
    return Array.from({ length: weeks * 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [first, weekStart]);
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of items) map.set(item.date.slice(0, 10), [...(map.get(item.date.slice(0, 10)) ?? []), item]);
    return map;
  }, [items]);
  const today = todayIso();
  const step = (n: number) => onMonth(iso(new Date(first.getFullYear(), first.getMonth() + n, 1)));
  const names = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + ((i + weekStart + 6) % 7)).toLocaleDateString(undefined, { weekday: 'short' }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-base font-semibold text-fg">{first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" aria-label="Previous month" onClick={() => step(-1)} className="rounded-md p-1.5 text-fg-muted hover:bg-surface-subtle hover:text-fg">
            <Icon name="chevronLeft" />
          </button>
          <button type="button" onClick={() => onMonth(today)} className="rounded-md px-2 py-1 text-sm text-fg-secondary hover:bg-surface-subtle hover:text-fg">
            Today
          </button>
          <button type="button" aria-label="Next month" onClick={() => step(1)} className="rounded-md p-1.5 text-fg-muted hover:bg-surface-subtle hover:text-fg">
            <Icon name="chevronRight" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 border-l border-t border-line-subtle">
        {names.map((n) => (
          <div key={n} className="border-b border-r border-line-subtle px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-fg-muted">
            {n}
          </div>
        ))}
        {days.map((d) => {
          const key = iso(d);
          const inMonth = d.getMonth() === first.getMonth();
          const dayItems = byDay.get(key) ?? [];
          return (
            <div
              key={key}
              onClick={onDay ? () => onDay(key) : undefined}
              className={clsx('flex min-h-24 flex-col gap-1 border-b border-r border-line-subtle p-1.5', !inMonth && 'bg-surface-subtle', onDay && 'cursor-pointer hover:bg-surface-subtle')}
            >
              <span
                className={clsx(
                  'flex size-6 items-center justify-center rounded-full text-xs tabular-nums',
                  key === today ? 'bg-accent-strong font-semibold text-fg-inverse' : inMonth ? 'text-fg-secondary' : 'text-fg-subtle',
                )}
              >
                {d.getDate()}
              </span>
              {(expandedDays.has(key) ? dayItems : dayItems.slice(0, 3)).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen?.(item.id);
                  }}
                  title={typeof item.title === 'string' ? item.title : undefined}
                  className="flex min-w-0 items-start gap-1.5 rounded bg-surface-subtle px-1.5 py-1 text-left text-xs text-fg hover:bg-surface-muted"
                >
                  <HueDot hue={item.hue ?? 'blue'} className="mt-1 shrink-0" />
                  <span className="line-clamp-2 whitespace-normal leading-snug">{item.title}</span>
                </button>
              ))}
              {dayItems.length > 3 && <button type="button" aria-expanded={expandedDays.has(key)} onClick={(e) => {
                e.stopPropagation();
                setExpandedDays((old) => { const next = new Set(old); if (next.has(key)) next.delete(key); else next.add(key); return next; });
              }} className="px-1 text-left text-xs font-medium text-fg-muted hover:text-fg">{expandedDays.has(key) ? 'Show less' : `+${dayItems.length - 3} more`}</button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
