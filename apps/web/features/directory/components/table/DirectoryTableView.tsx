'use client';

// The Directory's Table view: the toolbar, a row of type tabs, and one
// type's table. A table is per type because the columns are — a Person has
// a role and a company, an Event has a date and a capacity — so the type
// filter of the grid becomes a tab here, and the toolbar's remaining
// filters (search, alias, tag) narrow within it.
//
// Edits go straight to the record (`PATCH /api/nodes/<id>`) and are held
// optimistically over the fetched rows: the directory response is cached for
// half a minute, so a refetch could hand back the pre-edit value and the
// row must not flicker backwards. The overrides live as long as this view.

import { useCallback, useMemo, useState } from 'react';
import { Alert, UnderlineTabs } from '@/components/ui';
import DirectoryToolbar from '@/features/directory/components/DirectoryToolbar';
import ColumnsMenu from './ColumnsMenu';
import DirectoryTable from './DirectoryTable';
import { useTableView } from '@/features/directory/hooks/useTableView';
import { useTrackedFields } from '@/features/directory/hooks/useTrackedFields';
import type { useDirectoryBrowse } from '@/features/directory/hooks/useDirectoryBrowse';
import { fetchJsonBody } from '@/lib/fetchJson';
import {
  applyCellPatch,
  cellPatch,
  columnsForType,
  sortItems,
  type CellPatch,
  type TableColumn,
} from '@/lib/directory/table';
import { DEFAULT_NODE_TYPES, findNodeTypeConfig, type DirectoryItem, type SpaceAlias } from '@/lib/types';

interface DirectoryTableViewProps {
  browse: ReturnType<typeof useDirectoryBrowse>;
  /** The `?type=` in the URL, the type name lowercased, or null for "the first one". */
  type: string | null;
  onTypeChange: (type: string) => void;
}

export default function DirectoryTableView({ browse, type, onTypeChange }: DirectoryTableViewProps) {
  const { space, loading, error, filteredItems, presentTypes, handleItemClick, handleDataChanged, nodes } = browse;

  // The tabs: every type with entries, built-ins first in their canonical
  // order, then the space's own — so Person is always the first stop and a
  // type the space invented sits after the ones everyone has. A tab is keyed
  // by the type's own name, not its canonical base: Company folds onto Space
  // for the entity machinery, but a space that records both wants two tables.
  const tabs = useMemo(() => {
    const rank = (name: string) => {
      const i = DEFAULT_NODE_TYPES.findIndex((t) => t.name.toLowerCase() === name.toLowerCase());
      return i === -1 ? DEFAULT_NODE_TYPES.length : i;
    };
    return [...presentTypes]
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
      .map((name) => {
        const id = name.toLowerCase();
        const count = nodes.filter((n) => n.type.toLowerCase() === id).length;
        return { id, label: `${name} · ${count}`, name, count };
      })
      .filter((t) => t.count > 0);
  }, [presentTypes, nodes]);

  const activeKey = type && tabs.some((t) => t.id === type) ? type : tabs[0]?.id ?? null;
  const activeName = tabs.find((t) => t.id === activeKey)?.name ?? activeKey ?? '';

  const typeConfig = useMemo(
    () => (activeName ? findNodeTypeConfig(activeName, space?.nodeTypes) : null),
    [activeName, space?.nodeTypes],
  );
  const columns = useMemo(
    () => (activeKey ? columnsForType(activeKey, typeConfig) : []),
    [activeKey, typeConfig],
  );

  const table = useTableView(space?.id ?? null, activeKey ?? '', columns);
  const tracked = useTrackedFields();
  // The menu edits the current type's fields; the type is bound here.
  const fields = useMemo(
    () =>
      tracked.canEdit && activeName
        ? {
            saving: tracked.saving,
            error: tracked.error,
            clearError: tracked.clearError,
            add: (input: Parameters<typeof tracked.add>[1]) => tracked.add(activeName, input),
            remove: (key: string) => tracked.remove(activeName, key),
          }
        : undefined,
    [tracked, activeName],
  );

  // The rows: the toolbar's search/alias/tag result, narrowed to the tab's
  // type (the grid's type filter is not consulted here — the tab IS it),
  // with this view's edits laid over, in the header's sort.
  const [overrides, setOverrides] = useState<Map<string, CellPatch[]>>(new Map());
  const items = useMemo(() => {
    if (!activeKey) return [];
    const rows = filteredItems
      .filter((i) => i.type.toLowerCase() === activeKey)
      .map((i) => (overrides.get(i.id) ?? []).reduce(applyCellPatch, i));
    return sortItems(rows, columns, table.view.sort);
  }, [filteredItems, activeKey, overrides, columns, table.view.sort]);

  const [saveError, setSaveError] = useState<string | null>(null);
  const spaceId = space?.id ?? null;
  const saveCell = useCallback(
    async (item: DirectoryItem, column: TableColumn, value: unknown) => {
      const patch = cellPatch(column, value);
      if (!patch || !spaceId) return;
      setSaveError(null);
      try {
        await fetchJsonBody(`/api/nodes/${encodeURIComponent(item.id)}`, 'PATCH', { spaceId, ...patch });
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Could not save';
        setSaveError(message);
        throw new Error(message);
      }
      setOverrides((prev) => {
        const next = new Map(prev);
        next.set(item.id, [...(prev.get(item.id) ?? []), patch]);
        return next;
      });
      handleDataChanged();
    },
    [spaceId, handleDataChanged],
  );

  const aliases = (space?.aliases ?? []) as SpaceAlias[];

  // The view is a column exactly the pane's height: toolbar and tabs sit
  // still, the table is the one thing that scrolls — in both directions —
  // so its head can stick to its own top and its name column to its own
  // left. A page-scrolled table cannot have both: the horizontal scroller
  // would be the head's containing scroll box, not the page.
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0">
        <DirectoryToolbar
          browse={browse}
          mode="table"
          aliasType={activeName}
          trailing={
            activeKey ? (
              <ColumnsMenu
                typeName={activeName}
                arranged={table.arranged}
                view={table.view}
                onToggle={table.toggle}
                onMove={table.move}
                onReset={table.reset}
                fields={fields}
              />
            ) : null
          }
        />
      </div>

      <div className="shrink-0 px-6 pt-3">
        {tabs.length > 0 && (
          <UnderlineTabs
            tabs={tabs.map(({ id, label }) => ({ id, label }))}
            value={activeKey ?? tabs[0].id}
            onChange={onTypeChange}
            ariaLabel="Directory types"
          />
        )}

        {(error || saveError) && (
          <div className="py-2">
            <Alert variant="error" onDismiss={saveError ? () => setSaveError(null) : undefined}>
              {saveError ?? error}
            </Alert>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 px-6 pb-2">
        <DirectoryTable
          items={items}
          columns={table.visible}
          sort={table.view.sort}
          widths={table.view.widths}
          loading={loading}
          nodeTypes={space?.nodeTypes}
          aliases={aliases}
          tagColors={space?.designConfig?.tagColors ?? null}
          onSort={table.sortBy}
          onResize={table.resize}
          onReorder={table.placeBefore}
          onOpen={handleItemClick}
          onSaveCell={spaceId ? saveCell : undefined}
        />
      </div>
    </div>
  );
}
