/**
 * `DataTable` — `Table` with the three things a real dataset needs: sortable
 * columns, a header that stays put while the body scrolls, and windowing so a
 * few thousand rows do not become a few thousand DOM rows.
 *
 * Windowing is a small fixed-row-height implementation of its own rather than
 * a dependency: the kit bundle ships into every Tool, and two spacer rows plus
 * a scroll listener is all a table needs. Rows are assumed to be `rowHeight`
 * pixels tall when `virtualize` is on — give it a number if yours are not 40.
 */
import { useCallback, useMemo, useState } from 'react';
import type { ReactNode, UIEvent } from 'react';
import { clsx as cx } from 'clsx';
import { CLICKABLE_ROW, RIGHT, TABLE, TD, TH } from './tableClasses';

export type SortDirection = 'asc' | 'desc';

export interface DataTableSort {
  key: string;
  direction: SortDirection;
}

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right';
  /** Any CSS width — `'120px'`, `'30%'`. */
  width?: string;
  /**
   * `true` sorts by `value(row)` (or `row[key]` when `value` is absent) with
   * a locale-aware compare; a function is a comparator used as-is.
   */
  sortable?: boolean | ((a: T, b: T) => number);
  /** The value to sort on when `sortable: true`. */
  value?: (row: T) => unknown;
}

export interface DataTableProps<T> {
  columns: Array<DataTableColumn<T>>;
  rows: T[];
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  /** Shown in place of the rows when there are none. */
  empty?: ReactNode;
  /** Initial sort when uncontrolled. */
  defaultSort?: DataTableSort;
  /** Controlled sort. Pair with `onSortChange`. */
  sort?: DataTableSort | null;
  onSortChange?: (sort: DataTableSort | null) => void;
  /** Cap the body height (CSS pixels); the header sticks and the body scrolls. */
  maxHeight?: number;
  /**
   * Render only the visible rows. Needs `maxHeight`. `true` assumes 40px rows;
   * pass `{ rowHeight }` for other heights.
   */
  virtualize?: boolean | { rowHeight: number; overscan?: number };
  className?: string;
}

const DEFAULT_ROW_HEIGHT = 40;
const DEFAULT_OVERSCAN = 6;

function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function sortRows<T>(rows: T[], columns: Array<DataTableColumn<T>>, sort: DataTableSort | null): T[] {
  if (!sort) return rows;
  const column = columns.find((c) => c.key === sort.key);
  if (!column || !column.sortable) return rows;
  const compare =
    typeof column.sortable === 'function'
      ? column.sortable
      : (a: T, b: T) => {
          const pick = column.value ?? ((row: T) => (row as Record<string, unknown>)[column.key]);
          return compareValues(pick(a), pick(b));
        };
  const sign = sort.direction === 'asc' ? 1 : -1;
  // Stable: ties keep their incoming order.
  return rows
    .map((row, i) => [row, i] as const)
    .sort(([a, ai], [b, bi]) => sign * compare(a, b) || ai - bi)
    .map(([row]) => row);
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  empty,
  defaultSort,
  sort: controlledSort,
  onSortChange,
  maxHeight,
  virtualize = false,
  className,
}: DataTableProps<T>) {
  const [ownSort, setOwnSort] = useState<DataTableSort | null>(defaultSort ?? null);
  const sort = controlledSort !== undefined ? controlledSort : ownSort;

  const toggleSort = useCallback(
    (key: string) => {
      const next: DataTableSort | null =
        sort?.key !== key ? { key, direction: 'asc' } : sort.direction === 'asc' ? { key, direction: 'desc' } : null;
      if (controlledSort === undefined) setOwnSort(next);
      onSortChange?.(next);
    },
    [sort, controlledSort, onSortChange],
  );

  const sorted = useMemo(() => sortRows(rows, columns, sort), [rows, columns, sort]);

  const windowed = virtualize !== false && maxHeight !== undefined;
  const rowHeight = typeof virtualize === 'object' ? virtualize.rowHeight : DEFAULT_ROW_HEIGHT;
  const overscan = typeof virtualize === 'object' ? (virtualize.overscan ?? DEFAULT_OVERSCAN) : DEFAULT_OVERSCAN;
  const [scrollTop, setScrollTop] = useState(0);
  const onScroll = useCallback((e: UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop), []);

  let start = 0;
  let end = sorted.length;
  if (windowed) {
    start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    end = Math.min(sorted.length, Math.ceil((scrollTop + (maxHeight ?? 0)) / rowHeight) + overscan);
  }
  const visible = windowed ? sorted.slice(start, end) : sorted;
  const topPad = windowed ? start * rowHeight : 0;
  const bottomPad = windowed ? (sorted.length - end) * rowHeight : 0;

  const table = (
    <table className={TABLE}>
      <thead>
        <tr>
          {columns.map((c) => {
            const active = sort?.key === c.key;
            const sortable = Boolean(c.sortable);
            return (
              <th
                key={c.key}
                style={c.width ? { width: c.width } : undefined}
                className={cx(TH, c.align === 'right' && RIGHT, maxHeight !== undefined && 'sticky top-0 z-[1] bg-surface')}
                aria-sort={active ? (sort?.direction === 'asc' ? 'ascending' : 'descending') : undefined}
              >
                {sortable ? (
                  <button type="button" className="group inline-flex items-center gap-1 uppercase tracking-wide hover:text-fg" onClick={() => toggleSort(c.key)}>
                    <span>{c.header}</span>
                    {/* The sorted column says so; the rest show their arrow only under the pointer. */}
                    <span className={cx('text-[10px]', active ? 'text-fg' : 'opacity-0 group-hover:opacity-50')} aria-hidden>
                      {active ? (sort?.direction === 'asc' ? '▲' : '▼') : '▴'}
                    </span>
                  </button>
                ) : (
                  c.header
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {sorted.length === 0 && empty !== undefined ? (
          <tr>
            <td colSpan={columns.length} className={TD}>{empty}</td>
          </tr>
        ) : (
          <>
            {topPad > 0 && (
              <tr aria-hidden>
                <td colSpan={columns.length} style={{ height: topPad, padding: 0, border: 0 }} />
              </tr>
            )}
            {visible.map((row, i) => (
              <tr
                key={rowKey(row, start + i)}
                className={cx(onRowClick && CLICKABLE_ROW)}
                style={windowed ? { height: rowHeight } : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cx(TD, c.align === 'right' && RIGHT)}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
            {bottomPad > 0 && (
              <tr aria-hidden>
                <td colSpan={columns.length} style={{ height: bottomPad, padding: 0, border: 0 }} />
              </tr>
            )}
          </>
        )}
      </tbody>
    </table>
  );

  if (maxHeight === undefined) return <div className={cx('w-full overflow-x-auto', className)}>{table}</div>;
  return (
    <div className={cx('w-full overflow-auto', className)} style={{ maxHeight }} onScroll={onScroll}>
      {table}
    </div>
  );
}
