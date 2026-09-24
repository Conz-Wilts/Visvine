'use client';

// The Directory's Table view: one slim control bar (TableToolbar) and the
// table it names. A table is per type because the columns are — a Person has a
// role and a company, an Event has a date and a capacity — so the grid's type
// filter becomes a dropdown on the bar (TypeMenu) and search narrows within
// the table picked. `All` is the one table across types: the core every entity
// has — name, type, tags — and nothing a single type owns.
//
// Edits go straight to the record (`PATCH /api/nodes/<id>`) and are held
// optimistically over the fetched rows: the directory response is cached for
// half a minute, so a refetch could hand back the pre-edit value and the
// row must not flicker backwards. The overrides live as long as this view.

import { useCallback, useMemo, useState } from 'react';
import { Alert } from '@visvine/ui';
import TableToolbar from './TableToolbar';
import TypeMenu, { menuTypes } from '@/features/directory/components/TypeMenu';
import DirectoryTable from './DirectoryTable';
import AgentsClock from '@/features/agents/components/AgentsClock';
import { agentTableItem, switchOnBody } from '@/features/agents/lib/agentRows';
import { AGENT_TOOL_OPTIONS } from '@/lib/agents/config';
import { useAgentOptions } from '@/features/agents/lib/useAgentOptions';
import ConnectorsPanel from '@/features/connectors/components/ConnectorsPanel';
import { useConnectorCount } from '@/features/connectors/hooks/useConnectorCount';
import { useAgentsRoster } from '@/features/agents/lib/useAgentsRoster';
import { useTableView } from '@/features/directory/hooks/useTableView';
import { useTrackedFields } from '@/features/directory/hooks/useTrackedFields';
import type { useDirectoryBrowse } from '@/features/directory/hooks/useDirectoryBrowse';
import { fetchJsonBody } from '@/lib/fetchJson';
import { entityKindOf } from '@/lib/notes/entities';
import { tagKey } from '@/lib/tagColors';
import {
  applyCellPatch,
  cellPatch,
  columnsForType,
  sortItems,
  withKnownAliases,
  type CellPatch,
  type TableColumn,
} from '@/lib/directory/table';
import { findNodeTypeConfig, pluralTypeName, type DirectoryItem, type SpaceAlias } from '@/lib/types';

interface DirectoryTableViewProps {
  browse: ReturnType<typeof useDirectoryBrowse>;
  /** The `?type=` in the URL, the type name lowercased, or null for "the first one". */
  type: string | null;
  onTypeChange: (type: string) => void;
}

export default function DirectoryTableView({ browse, type, onTypeChange }: DirectoryTableViewProps) {
  const { space, loading, error, filteredItems, presentTypes, handleItemClick, handleDataChanged, nodes } = browse;

  // Agents are not in the directory feed (their nodes are structural, like a
  // connector's), so the menu's Agents entry — and the rows under it — come
  // from the agents route: each agent's record and live state as a row
  // (agentRows.ts). Followed live only while it is the table shown.
  const isAgents = type?.toLowerCase() === 'agent';
  const roster = useAgentsRoster(space?.id ?? null, isAgents);
  const { options: agentOptions } = useAgentOptions(isAgents ? (space?.id ?? null) : null);
  const agentChoices = useMemo(
    () => ({
      models: (agentOptions?.models ?? []).map((m) => m.ref).filter((ref): ref is string => !!ref),
      connectors: (agentOptions?.connectors ?? []).map((c) => c.name),
      tools: AGENT_TOOL_OPTIONS.map((t) => t.id),
    }),
    [agentOptions],
  );
  // Connectors likewise: the space's gateways, as each person meets them —
  // sign in, ask for access, ask for a service. The console's own panel,
  // which already knows an admin from a member.
  const isConnectors = type?.toLowerCase() === 'connector';
  const connectorCount = useConnectorCount(space?.id ?? null);
  const [connectorView, setConnectorView] = useState<'mine' | 'catalog'>('mine');
  const types = useMemo(
    () => menuTypes(
      presentTypes,
      nodes,
      [
        { id: 'agent', name: 'Agent', count: roster.data?.agents.length ?? 0 },
        { id: 'connector', name: 'Connector', count: connectorCount, always: true },
      ],
      space?.aliases as SpaceAlias[] | undefined,
    ),
    [presentTypes, nodes, roster.data, connectorCount, space?.aliases],
  );

  // The `?type=` is usually a type's own name, but crossing from a context note
  // it is the namespace's entity KIND (`spaces/` → space), and a space may
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
    () => (activeKey ? columnsForType(activeKey, typeConfig, { agent: agentChoices }) : []),
    [activeKey, typeConfig, agentChoices],
  );

  const table = useTableView(space?.id ?? null, activeKey ?? '', columns);
  const tracked = useTrackedFields();
  // The menus edit the current type's fields; the type is bound here.
  const fields = useMemo(
    () =>
      tracked.canEdit && activeName && !isAll && !isAgents
        ? {
            saving: tracked.saving,
            error: tracked.error,
            clearError: tracked.clearError,
            add: (input: Parameters<typeof tracked.add>[1]) => tracked.add(activeName, input),
            update: (key: string, patch: Parameters<typeof tracked.update>[2]) => tracked.update(activeName, key, patch),
            remove: (key: string) => tracked.remove(activeName, key),
          }
        : undefined,
    [tracked, activeName, isAll, isAgents],
  );

  // The rows: the toolbar's search/alias/tag result, narrowed to the table's
  // type (the grid's type filter is not consulted here — the dropdown IS it),
  // with this view's edits laid over, in the header's sort.
  const [overrides, setOverrides] = useState<Map<string, CellPatch[]>>(new Map());
  const aliasNames = useMemo(() => new Set((space?.aliases ?? []).map((a) => (a as SpaceAlias).name)), [space?.aliases]);
  const agentItems = useMemo(() => {
    if (!isAgents || !roster.data) return [];
    const q = browse.searchTerm.trim().toLowerCase();
    return roster.data.agents
      .filter((a) => {
        for (const want of browse.filterTags) if (!a.tags.some((t) => t.toLowerCase() === want.toLowerCase())) return false;
        return !q || [a.name, a.title, a.description ?? '', ...a.tags].some((v) => v.toLowerCase().includes(q));
      })
      .map((a) => agentTableItem(a, roster.now));
  }, [isAgents, roster.data, roster.now, browse.searchTerm, browse.filterTags]);
  const items = useMemo(() => {
    if (!activeKey) return [];
    const rows = (isAgents ? agentItems : filteredItems.filter((i) => isAll || i.type.toLowerCase() === activeKey))
      .map((i) => (overrides.get(i.id) ?? []).reduce(applyCellPatch, i));
    return sortItems(withKnownAliases(rows, aliasNames), columns, table.view.sort);
  }, [filteredItems, agentItems, isAgents, activeKey, isAll, aliasNames, overrides, columns, table.view.sort]);

  const [saveError, setSaveError] = useState<string | null>(null);
  const spaceId = space?.id ?? null;
  const suggestCell = useCallback(
    async (item: DirectoryItem, column: TableColumn): Promise<string | null> => {
      if (!spaceId || !column.options?.length) return null;
      const res = await fetchJsonBody<{ suggested: string | null }>(
        `/api/nodes/${encodeURIComponent(item.id)}/suggest`,
        'POST',
        { spaceId, label: column.label, options: column.options },
      ).catch(() => null);
      return res?.suggested ?? null;
    },
    [spaceId],
  );

  const saveCell = useCallback(
    async (item: DirectoryItem, column: TableColumn, value: unknown) => {
      const patch = cellPatch(column, value);
      // Another space's row read here (people flow) is not this space's to edit.
      if (!patch || !spaceId) return;
      setSaveError(null);
      try {
        // An agent's cell is its record, saved where every setting of it is:
        // the switch through activation, the rest through its config.
        if (item.type === 'agent') {
          const name = item.id.slice('agent:'.length);
          const agentUrl = `/api/spaces/${encodeURIComponent(spaceId)}/agents/${encodeURIComponent(name)}`;
          if (column.key === 'active') {
            const summary = roster.data?.agents.find((a) => a.name === name);
            const body = value ? (summary ? switchOnBody(summary.activation) : null) : { active: false };
            if (!body) throw new Error('Set when it runs on its page first.');
            await fetchJsonBody(agentUrl, 'PATCH', body);
          } else {
            const next = Array.isArray(value) ? value.map(String) : typeof value === 'string' && value ? value : null;
            await fetchJsonBody(`${agentUrl}/config`, 'PUT', { [column.key]: next ?? (column.kind === 'tags' ? [] : null) });
          }
        } else {
          await fetchJsonBody(`/api/nodes/${encodeURIComponent(item.id)}`, 'PATCH', { spaceId, ...patch });
        }
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
      // An agent's row is the roster's, which follows itself; the directory's
      // own records are refetched.
      if (item.type !== 'agent') handleDataChanged();
    },
    [spaceId, handleDataChanged, roster.data],
  );

  const aliases = (space?.aliases ?? []) as SpaceAlias[];

  // The Tags editor's list is every tag on any record here, whatever table is
  // showing; a tag made in it registers its colour on the space the way the
  // note's picker does, held here until the space record comes back with it.
  const tagPool = useMemo(() => [...new Set(nodes.flatMap((n) => n.tags ?? []))], [nodes]);
  const [tagColorOverride, setTagColorOverride] = useState<Record<string, string>>({});
  const tagColors = useMemo(
    () => ({ ...(space?.designConfig?.tagColors ?? {}), ...tagColorOverride }),
    [space?.designConfig?.tagColors, tagColorOverride],
  );
  const createTag = useCallback(
    (tag: string, color: string) => {
      if (!spaceId) return;
      setTagColorOverride((m) => ({ ...m, [tagKey(tag)]: color }));
      void fetchJsonBody(`/api/spaces/${encodeURIComponent(spaceId)}/tag-colors`, 'PATCH', { tag, color }).catch(() => undefined);
    },
    [spaceId],
  );

  // A column exactly the pane's height: toolbar and tabs sit still, the table
  // is the one thing that scrolls — in both directions — so its head can stick
  // to its own top and its name column to its own left. A page-scrolled table
  // cannot have both: the horizontal scroller would be the head's containing
  // scroll box, not the page.
  return (
    // No left padding: the bar's first control stands on the same line as the
    // table's left edge under it, so the two read as one column.
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="shrink-0 pr-4 pt-1.5">
        {/* Search is one of the bar's controls here, not a band of its own: the
            Table already states what it is showing and narrows it from that
            line, so the box belongs on it, at the height of the buttons beside
            it. The Grid keeps the big field, where search IS
            the surface. */}
        <TableToolbar
          browse={browse}
          typeMenu={
            <TypeMenu
              types={types}
              activeKey={activeKey ?? ''}
              activeAlias={browse.filterAliases.size === 1 ? [...browse.filterAliases][0] : null}
              nodeTypes={space?.nodeTypes}
              onChange={(id, alias) => {
                onTypeChange(id);
                browse.setFilterAliases(alias ? new Set([alias]) : new Set());
              }}
            />
          }
          searchPlaceholder={
            activeName && !isAll
              ? `Search ${pluralTypeName(activeName, space?.nodeTypes).toLowerCase()}…`
              : 'Search the directory…'
          }
        />

        {(error || saveError || (isAgents && roster.error)) && (
          <div className="py-2">
            <Alert variant="error" onDismiss={saveError ? () => setSaveError(null) : undefined}>
              {saveError ?? error ?? roster.error}
            </Alert>
          </div>
        )}
      </div>

      {/* The frame draws no lines: a border here sits outside the scroll box's
          scrollbars, so its right one would stand clear of where every row
          line ends and its sides would run on under the horizontal bar. The
          table traces its own box on the scrollport instead (DirectoryTable);
          the connectors panel, which does not scroll sideways, takes a plain frame. */}
      <div className="min-h-0 flex-1">
        {isConnectors && spaceId ? (
          <div className="h-full overflow-y-auto border-t border-line-subtle px-4 py-3">
            <div className="mx-auto max-w-2xl">
              {connectorView === 'catalog' && (
                <button type="button" className="mb-2 text-[13px] text-fg-secondary hover:text-fg" onClick={() => setConnectorView('mine')}>
                  ← In this space
                </button>
              )}
              <ConnectorsPanel
                key={spaceId}
                space={spaceId}
                view={connectorView}
                returnTo="/directory?view=table&type=connector"
              />
            </div>
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            {/* The next 24 hours across every agent, over the agents' table. */}
            {isAgents && <AgentsClock data={roster.data} now={roster.now} />}
            <div className="min-h-0 flex-1">
              <DirectoryTable
                items={items}
                columns={table.visible}
                allColumns={table.arranged}
                typeName={activeName}
                sort={table.view.sort}
                widths={table.view.widths}
                loading={isAgents ? !roster.data : loading}
                nodeTypes={space?.nodeTypes}
                aliases={aliases}
                tagColors={tagColors}
                tagPool={tagPool}
                onCreateTag={createTag}
                fields={fields}
                onSortChange={table.setSort}
                onResize={table.resize}
                onReorder={table.placeBefore}
                onShowColumn={table.toggle}
                onHideColumn={table.toggle}
                onResetColumns={table.reset}
                onOpen={handleItemClick}
                onSaveCell={spaceId ? saveCell : undefined}
                onSuggestCell={spaceId && !isAgents ? suggestCell : undefined}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
