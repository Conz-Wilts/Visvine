'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  EMPTY_VIEW,
  coerceView,
  cycleSort,
  moveColumn,
  placeColumnBefore,
  resetColumns,
  setColumnWidth,
  toggleColumn,
  visibleColumns,
  arrangeColumns,
  type TableColumn,
  type TableView,
} from '@/lib/directory/table';

/**
 * A viewer's arrangement of one type's table — which columns, in what order,
 * at what widths, sorted how. Kept in the browser, per space and type: it is
 * a convenience for the person looking, not a fact about the space, so it
 * never rides the space record and never reaches another viewer. Reads and
 * writes are guarded — storage can be absent or throw, and the table renders
 * the canonical arrangement then.
 */
export function useTableView(spaceId: string | null, typeKey: string, columns: TableColumn[]) {
  const storageKey = spaceId ? `visvine:directory-table:${spaceId}:${typeKey}` : null;
  const [view, setView] = useState<TableView>(EMPTY_VIEW);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      setView(raw ? coerceView(JSON.parse(raw)) : EMPTY_VIEW);
    } catch {
      setView(EMPTY_VIEW);
    }
  }, [storageKey]);

  const update = useCallback(
    (next: TableView | ((current: TableView) => TableView)) => {
      setView((current) => {
        const resolved = typeof next === 'function' ? next(current) : next;
        if (storageKey) {
          try {
            window.localStorage.setItem(storageKey, JSON.stringify(resolved));
          } catch {
            // Storage full or blocked: the arrangement still holds for this page.
          }
        }
        return resolved;
      });
    },
    [storageKey],
  );

  const visible = useMemo(() => visibleColumns(view, columns), [view, columns]);
  const arranged = useMemo(() => arrangeColumns(view, columns), [view, columns]);

  return {
    view,
    visible,
    arranged,
    sortBy: useCallback((key: string) => update((v) => ({ ...v, sort: cycleSort(v.sort, key) })), [update]),
    toggle: useCallback((key: string) => update((v) => toggleColumn(v, columns, key)), [update, columns]),
    move: useCallback((key: string, dir: -1 | 1) => update((v) => moveColumn(v, columns, key, dir)), [update, columns]),
    placeBefore: useCallback(
      (key: string, before: string | null) => update((v) => placeColumnBefore(v, columns, key, before)),
      [update, columns],
    ),
    resize: useCallback((key: string, width: number) => update((v) => setColumnWidth(v, key, width)), [update]),
    reset: useCallback(() => update((v) => resetColumns(v)), [update]),
  };
}
