'use client';

// The Directory's Table view: a slim control bar (TableToolbar), the strip
// of tables (TypeStrip) and one of them. A table is per type because the
// columns are — a Person has a role and a company, an Event has a date and a
// capacity — so the grid's type filter becomes the strip here, and the bar's
// filters (search, alias, tag) narrow within the table picked. `All` is the
// one table across types: the core every entity has — name, type, tags —
// and nothing a single type owns.
//
// Edits go straight to the record (`PATCH /api/nodes/<id>`) and are held
// optimistically over the fetched rows: the directory response is cached for
// half a minute, so a refetch could hand back the pre-edit value and the
// row must not flicker backwards. The overrides live as long as this view.

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui';
import ColumnsMenu from './ColumnsMenu';
import TableToolbar from './TableToolbar';
import TypeStrip from './TypeStrip';
import DirectoryTable from './DirectoryTable';
import AgentsRoster from '@/features/agents/components/AgentsRoster';
import { useAgentsRoster } from '@/features/agents/lib/useAgentsRoster';
import { useTableView } from '@/features/directory/hooks/useTableView';
import { useTrackedFields } from '@/features/directory/hooks/useTrackedFields';
import type { useDirectoryBrowse } from '@/features/directory/hooks/useDirectoryBrowse';
import { fetchJsonBody } from '@/lib/fetchJson';
import { entityKindOf } from '@/lib/notes/entities';
import {
  applyCellPatch,
  cellPatch,
  columnsForType,
  sortItems,
  withKnownAliases,
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
  const router = useRouter();

  // The type menu's entries: every type with rows, built-ins first in their
  // canonical order, then the space's own — so Person is always the first
  // stop and a type the space invented sits after the ones everyone has. An
  // entry is keyed by the type's own name, not its canonical base: Company
  // folds onto Space for the entity machinery, but a space that records both
  // wants two tables.
  // Agents are not in the directory feed (their nodes are structural, like a
  // connector's), so the menu's Agents entry — and the roster under it — come
  // from the agents route. Followed live only while it is the table shown.
  const isAgents = type?.toLowerCase() === 'agent';
  const roster = useAgentsRoster(space?.id ?? null, isAgents);
  const types = useMemo(() => {
    const rank = (name: string) => {
      const i = DEFAULT_NODE_TYPES.findIndex((t) => t.name.toLowerCase() === name.toLowerCase());
      return i === -1 ? DEFAULT_NODE_TYPES.length : i;
    };
    const fromNodes = [...presentTypes]
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
      .map((name) => {
        const id = name.toLowerCase();
        const count = nodes.filter((n) => n.type.toLowerCase() === id).length;
        return { id, name, count };
      })
      .filter((t) => t.count > 0);
    const agentCount = roster.data?.agents.length ?? 0;
    const withAgents = agentCount > 0 ? [...fromNodes, { id: 'agent', name: 'Agent', count: agentCount }] : fromNodes;
    // All leads when there is more than one table to be all of.
    return withAgents.length > 1 ? [{ id: 'all', name: 'All', count: nodes.length }, ...withAgents] : withAgents;
  }, [presentTypes, nodes, roster.data]);

  // The `?type=` is usually a type's own name, but crossing from a context note
  // it is the namespace's entity KIND (`communities/` → space), and a space may
  // record that kind under a name of its own — Company folds onto space. So an
  // id that names no table falls back to the first type of the same kind before
  // giving up and taking the first table there is.
  const activeKey = useMemo(() => {
    if (type) {
      const exact = types.find((t) => t.id === type.toLowerCase());
      if (exact) return exact.id;
      const kind = entityKindOf(type);
      const sameKind = kind ? types.find((t) => entityKindOf(t.name) === kind) : undefined;
      if (sameKind) return sameKind.id;
    }
    // No type named: the first REAL table, so a fresh visit lands on People
    // rather than on the cross-type view.
    return types.find((t) => t.id !== 'all')?.id ?? types[0]?.id ?? null;
  }, [type, types]);
  const isAll = activeKey === 'all';
  const activeName = types.find((t) => t.id === activeKey)?.name ?? activeKey ?? '';

  const typeConfig = useMemo(
    () => (activeName && !isAll ? findNodeTypeConfig(activeName, space?.nodeTypes) : null),
    [activeName, isAll, space?.nodeTypes],
  );
  const columns = useMemo(
    () => (activeKey ? columnsForType(activeKey, typeConfig) : []),
    [activeKey, typeConfig],
  );

  const table = useTableView(space?.id ?? null, activeKey ?? '', columns);
  const tracked = useTrackedFields();
  // The menus edit the current type's fields; the type is bound here.
  const fields = useMemo(
    () =>
      tracked.canEdit && activeName && !isAll
        ? {
            saving: tracked.saving,
            error: tracked.error,
            clearError: tracked.clearError,
            add: (input: Parameters<typeof tracked.add>[1]) => tracked.add(activeName, input),
            update: (key: string, patch: Parameters<typeof tracked.update>[2]) => tracked.update(activeName, key, patch),
            remove: (key: string) => tracked.remove(activeName, key),
          }
        : undefined,
    [tracked, activeName, isAll],
  );

  // The "+" menu's stock: what the type has that this view isn't showing.
  const hiddenColumns = useMemo(() => {
    const shown = new Set(table.visible.map((c) => c.key));
    return table.arranged.filter((c) => !shown.has(c.key));
  }, [table.visible, table.arranged]);

  // The rows: the toolbar's search/alias/tag result, narrowed to the tab's
  // type (the grid's type filter is not consulted here — the tab IS it),
  // with this view's edits laid over, in the header's sort.
  const [overrides, setOverrides] = useState<Map<string, CellPatch[]>>(new Map());
  const aliasNames = useMemo(() => new Set((space?.aliases ?? []).map((a) => (a as SpaceAlias).name)), [space?.aliases]);
  const items = useMemo(() => {
    if (!activeKey) return [];
    const rows = filteredItems
      .filter((i) => isAll || i.type.toLowerCase() === activeKey)
      .map((i) => (overrides.get(i.id) ?? []).reduce(applyCellPatch, i));
    return sortItems(withKnownAliases(rows, aliasNames), columns, table.view.sort);
  }, [filteredItems, activeKey, isAll, aliasNames, overrides, columns, table.view.sort]);

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

  // A column exactly the pane's height: toolbar and tabs sit still, the table
  // is the one thing that scrolls — in both directions — so its head can stick
  // to its own top and its name column to its own left. A page-scrolled table
  // cannot have both: the horizontal scroller would be the head's containing
  // scroll box, not the page.
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="shrink-0 px-6 pt-1">
        {/* Search is one of the bar's controls here, not a band of its own: the
            Table already states what it is showing and narrows it from that
            line, so the box belongs on it, at the height of the buttons beside
            it. The Grid and Resources tabs keep the big field, where search IS
            the surface. */}
        <TableToolbar
          browse={browse}
          searchPlaceholder={activeName && !isAll ? `Search ${activeName.toLowerCase()}s…` : 'Search the directory…'}
          typeKey={activeKey ?? ''}
          columns={isAgents ? [] : table.visible}
          tagOptions={isAgents ? [...new Set((roster.data?.agents ?? []).flatMap((a) => a.tags))].sort() : undefined}
          sort={table.view.sort}
          onSortChange={table.setSort}
          trailing={
            activeKey && !isAgents ? (
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

        <div className="pb-3 pt-1">
          <TypeStrip types={types} activeKey={activeKey ?? ''} nodeTypes={space?.nodeTypes} onChange={onTypeChange} />
        </div>

        {(error || saveError) && (
          <div className="py-2">
            <Alert variant="error" onDismiss={saveError ? () => setSaveError(null) : undefined}>
              {saveError ?? error}
            </Alert>
          </div>
        )}
      </div>

      {/* The table bleeds to the pane's right and bottom edges: it is the
          pane's own grid, not a box on it. A hairline over the head is the
          only line between it and the toolbar. */}
      <div className="min-h-0 flex-1 border-t border-border-subtle">
        {/* Agents are not rows of a record: every column is live state — what
            it is doing, when it fires next, who for — so the type gets the
            roster with the clock over it rather than the cell grid. Same bar,
            same search and tag filter, same click-through. */}
        {isAgents && spaceId ? (
          <AgentsRoster data={roster.data} error={roster.error} now={roster.now} search={browse.searchTerm} tags={browse.filterTags} onNavigate={(href) => router.push(href)} />
        ) : (
        <DirectoryTable
          items={items}
          columns={table.visible}
          hiddenColumns={hiddenColumns}
          typeName={activeName}
          sort={table.view.sort}
          widths={table.view.widths}
          loading={loading}
          nodeTypes={space?.nodeTypes}
          aliases={aliases}
          tagColors={space?.designConfig?.tagColors ?? null}
          fields={fields}
          onSortChange={table.setSort}
          onResize={table.resize}
          onReorder={table.placeBefore}
          onShowColumn={table.toggle}
          onHideColumn={table.toggle}
          onOpen={handleItemClick}
          onSaveCell={spaceId ? saveCell : undefined}
        />
        )}
      </div>
    </div>
  );
}
