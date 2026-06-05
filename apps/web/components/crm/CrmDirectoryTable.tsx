'use client';

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { TableVirtuoso, type TableComponents } from 'react-virtuoso';
import { Lock, Plus, X } from 'lucide-react';
import { uploadCroppedImage, validateImageFile } from '@/lib/imageUpload';
import ImageCropper from '@/components/data/ImageCropper';
import type { AdminProfileNode } from '@/app/api/communities/[communityId]/admin/profiles/route';
import type { DirectoryItem } from '@/components/dashboard/types';
import type { NodeTypeConfig, CommunityAlias } from '@/lib/types';
import { aliasesForType } from '@/lib/types';
import { EmptyState, Skeleton } from '@/components/ui';
import { useCrmColumns, prvKey, comKey, CrmColumnType } from '@/hooks/useCrmColumns';
import { patchAdminProfile } from '@/lib/crm/adminProfileApi';
import AddColumnModal from './AddColumnModal';
import RequestUpgradePrompt from './RequestUpgradePrompt';
import DirectoryRowCells from './DirectoryRowCells';
import { getProfileColumns } from './profileColumns';

const UPGRADE_THRESHOLD = 3;

// Sliding window: how many rows on each side of the on-screen range to keep CRM
// values loaded for. Rows that scroll beyond this buffer are evicted (and
// re-fetched if scrolled back to), so the table never holds the whole directory
// in memory at once — it loads near the viewport and unloads far from it.
const KEEP_BUFFER = 100;

function DirectoryTableSkeleton({ extraColumns = 4 }: { extraColumns?: number }) {
  // Always render at least name + type + a few extras so the skeleton looks like the real table
  const colCount = Math.max(4, 2 + extraColumns);
  return (
    <div className="w-full bg-surface-1 border border-border-default rounded-2xl shadow-soft overflow-hidden">
      <div className="overflow-x-auto w-full">
        <table className="w-full divide-y divide-border-subtle [&_th]:border-r [&_td]:border-r [&_th]:border-border-subtle [&_td]:border-border-subtle [&_th:last-child]:border-r-0 [&_td:last-child]:border-r-0">
          <thead className="bg-surface-2">
            <tr>
              {Array.from({ length: colCount }).map((_, i) => (
                <th key={i} className="px-4 py-2.5 text-left">
                  <Skeleton className="h-3 w-20" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-surface-1 divide-y divide-border-subtle">
            {Array.from({ length: 8 }).map((_, rowIdx) => (
              <tr key={rowIdx}>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-8 w-8 rounded-full" />
                    <Skeleton className="h-3.5 w-32" />
                  </div>
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <Skeleton className="h-5 w-16 rounded-full" />
                </td>
                {Array.from({ length: colCount - 2 }).map((_, i) => (
                  <td key={i} className="px-4 py-2.5 whitespace-nowrap">
                    <Skeleton className="h-3 w-24" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Virtualized table scaffolding ──────────────────────────────────────────────
// Per-row context so the (stable) custom components can style/handle each row
// without re-creating component identities on every render.
interface RowContext {
  editMode: boolean;
  isEditable: (id: string) => boolean;
  isMember: (id: string) => boolean;
  onRowClick?: (item: DirectoryItem) => void;
  // Explicit per-column widths (px) for the fixed-layout <colgroup>. Length and
  // order must match the header/row cells: Name, Type, …profile, …crm, spacer.
  columnWidths: number[];
}

type CtxProp = { context?: RowContext };

// react-virtuoso types each `TableComponents` slot with its own internal prop
// shapes (item/context + data-index plumbing) that these hand-written components
// don't structurally satisfy (verified: a `satisfies` check fails even with a
// single @types/react in the tree — it isn't a duplicate-types issue). The
// per-component param types above keep each body type-safe; only the assembled
// map is cast.
const tableComponents = {
  // Minimal scroller: forward the ref and set overflow only. The floating cell
  // highlight lives in the card wrapper (a sibling of Virtuoso), NOT here —
  // TableVirtuoso's window-scroll measurement breaks if its Scroller contains
  // any child other than Virtuoso's own content, which silently freezes
  // virtualization on the first rows for long lists.
  //
  // overflow-y-hidden is deliberate: with `useWindowScroll`, vertical scrolling
  // belongs to the page. Setting only overflow-x would make the browser compute
  // overflow-y to `auto` too (CSS overflow spec), adding an unwanted second
  // vertical scrollbar inside the table.
  Scroller: React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'> & CtxProp>(
    function Scroller({ context: _context, ...props }, ref) {
      return <div ref={ref} {...props} className="overflow-x-auto overflow-y-hidden w-full" />;
    }
  ),
  Table: ({ context, style, children, ...props }: React.ComponentPropsWithoutRef<'table'> & CtxProp) => {
    // Fixed layout: the browser sizes columns from the <colgroup> once instead
    // of re-measuring every cell as rows mount/unmount during virtual scroll.
    const widths = context?.columnWidths ?? [];
    const minWidth = widths.reduce((sum, w) => sum + w, 0);
    return (
      <table
        {...props}
        // `w-full` + minWidth: fill the container, but never shrink below the
        // column sum (then the scroller scrolls horizontally). NOTE: do not
        // replace w-full with an explicit `width` — TableVirtuoso's window-scroll
        // height measurement breaks for long lists when the table has a fixed
        // px width, leaving virtualization stuck on the first rows.
        style={{ ...style, tableLayout: 'fixed', minWidth: minWidth || undefined, borderCollapse: 'separate', borderSpacing: 0 }}
        className="w-full divide-y divide-border-subtle [&_th]:border-r [&_td]:border-r [&_th]:border-border-subtle [&_td]:border-border-subtle [&_th:last-child]:border-r-0 [&_td:last-child]:border-r-0"
      >
        {widths.length > 0 && (
          <colgroup>
            {widths.map((w, i) => <col key={i} style={{ width: w }} />)}
          </colgroup>
        )}
        {children}
      </table>
    );
  },
  TableHead: React.forwardRef<HTMLTableSectionElement, React.ComponentPropsWithoutRef<'thead'> & CtxProp>(
    function TableHead({ context: _context, ...props }, ref) {
      // z-20 keeps the sticky header above the floating cell highlight (z-10).
      return <thead {...props} ref={ref} className="bg-surface-2 z-20" />;
    }
  ),
  TableBody: React.forwardRef<HTMLTableSectionElement, React.ComponentPropsWithoutRef<'tbody'> & CtxProp>(
    function TableBody({ context: _context, ...props }, ref) {
      return <tbody {...props} ref={ref} className="bg-surface-1 divide-y divide-border-subtle" />;
    }
  ),
  TableRow: ({ item, context, style, ...props }: React.ComponentPropsWithoutRef<'tr'> & { item: DirectoryItem } & CtxProp) => {
    const ctx = context!;
    const editable = ctx.isEditable(item.id);
    const isMemberRow = ctx.isMember(item.id);
    return (
      <tr
        {...props}
        style={{ ...style, opacity: ctx.editMode && isMemberRow ? 0.5 : 1 }}
        className={`group relative ${ctx.editMode ? (editable ? 'cursor-default' : 'cursor-default opacity-60') : 'cursor-pointer'}`}
        onClick={ctx.editMode ? undefined : () => ctx.onRowClick?.(item)}
      />
    );
  },
} as unknown as TableComponents<DirectoryItem, RowContext>;

interface CrmDirectoryTableProps {
  items: DirectoryItem[];
  loading?: boolean;
  onRowClick?: (item: DirectoryItem) => void;
  nodeTypes?: NodeTypeConfig[];
  communityAliases?: CommunityAlias[];
  communityId: string | null | undefined;
  isAdmin?: boolean;
  editMode?: boolean;
  activeType?: string;
  onDataChanged?: () => void;
}

export default function CrmDirectoryTable({
  items,
  loading = false,
  onRowClick,
  nodeTypes,
  communityAliases,
  communityId,
  isAdmin = false,
  editMode = false,
  activeType = 'person',
  onDataChanged,
}: CrmDirectoryTableProps) {
  // ── Sliding data window ─────────────────────────────────────────────────────
  // The DOM is virtualized (only on-screen rows mount). On top of that we load
  // CRM values only for a window of rows around the viewport, tracked via
  // Virtuoso's visible range; rows outside the window are evicted by useCrmColumns
  // and re-fetched if scrolled back to. Memory stays bounded at any directory size.
  const [range, setRange] = useState({ startIndex: 0, endIndex: 0 });
  // Guard: only update when the range actually changes. Virtuoso re-emits
  // rangeChanged with a fresh object on every internal render; setting state
  // unconditionally would re-render → recompute nodeIds → re-render in a loop
  // that starves Virtuoso's scroll handling (it would freeze at the first range).
  const handleRangeChanged = useCallback((r: { startIndex: number; endIndex: number }) => {
    setRange(prev => (prev.startIndex === r.startIndex && prev.endIndex === r.endIndex ? prev : r));
  }, []);
  // Reset the window when the underlying set changes (filter / search / sort);
  // Virtuoso then re-emits rangeChanged for the new data and the window follows.
  useEffect(() => { setRange({ startIndex: 0, endIndex: 0 }); }, [items]);

  const nodeIds = useMemo(() => {
    if (items.length === 0) return [];
    const start = Math.max(0, range.startIndex - KEEP_BUFFER);
    const end = Math.min(items.length, range.endIndex + KEEP_BUFFER + 1);
    return items.slice(start, end).map(i => i.id);
  }, [items, range]);

  // ── Floating cell highlight ─────────────────────────────────────────────────
  // A single overlay that glides + resizes between cells as the pointer moves
  // (spreadsheet "magic move"), driven imperatively (refs + rAF) so mousemove
  // never triggers a React render. It lives in the card wrapper, NOT inside
  // Virtuoso's Scroller (an extra child there breaks Virtuoso's measurement).
  const cardRef = useRef<HTMLDivElement>(null);
  const cellOverlayRef = useRef<HTMLDivElement>(null);
  const overlayRafRef = useRef<number | null>(null);
  const pendingTdRef = useRef<HTMLElement | null>(null);
  const placeOverlay = useCallback(() => {
    overlayRafRef.current = null;
    const overlay = cellOverlayRef.current;
    const card = cardRef.current;
    if (!overlay || !card) return;
    const td = pendingTdRef.current;
    if (!td) { overlay.style.opacity = '0'; return; }
    const cr = td.getBoundingClientRect();
    const kr = card.getBoundingClientRect();
    // First reveal: snap into place (duration 0) so it doesn't slide in from the
    // corner; afterwards let the CSS transition glide between cells.
    const reveal = overlay.style.opacity !== '1';
    if (reveal) overlay.style.transitionDuration = '0s';
    overlay.style.width = `${cr.width}px`;
    overlay.style.height = `${cr.height}px`;
    overlay.style.transform = `translate(${cr.left - kr.left}px, ${cr.top - kr.top}px)`;
    if (reveal) { void overlay.offsetWidth; overlay.style.transitionDuration = ''; }
    overlay.style.opacity = '1';
  }, []);
  const scheduleOverlay = useCallback((td: HTMLElement | null) => {
    pendingTdRef.current = td;
    if (overlayRafRef.current == null) overlayRafRef.current = requestAnimationFrame(placeOverlay);
  }, [placeOverlay]);

  const {
    isAuthenticated,
    columnsLoading,
    privateColumns,
    communityColumns,
    pendingRequests,
    valueMap,
    privateValueCounts,
    addPrivateColumn,
    removePrivateColumn,
    requestCommunityColumn,
    savePrivateValue,
    saveCommunityValue,
    shareValueWithCommunity,
  } = useCrmColumns({ communityId, nodeIds });

  const [showAddModal, setShowAddModal] = useState(false);
  const [modalDefaultName, setModalDefaultName] = useState<string | undefined>();
  const [modalDefaultType, setModalDefaultType] = useState<CrmColumnType | undefined>();
  const [editingCell, setEditingCell] = useState<{ nodeId: string; key: string } | null>(null);
  const [dismissedPrompts, setDismissedPrompts] = useState<Set<string>>(new Set());
  const [adminNodes, setAdminNodes] = useState<Map<string, AdminProfileNode>>(new Map());

  // Profile inline editing state — tracks only WHICH cell is open; the editor
  // (CellEditor) owns the draft value locally, so typing never re-renders rows.
  const [profileCell, setProfileCell] = useState<{ nodeId: string; field: string } | null>(null);
  const [aliasEditNodeId, setAliasEditNodeId] = useState<string | null>(null);
  const profileFileRef = useRef<HTMLInputElement>(null);
  const profileFileTarget = useRef<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [tableCropperState, setTableCropperState] = useState<{ file: File; nodeId: string } | null>(null);

  // Local image overrides so the cell updates immediately after upload
  const [imageOverrides, setImageOverrides] = useState<Map<string, string>>(new Map());
  // Local alias overrides for immediate visual feedback
  const [aliasOverrides, setAliasOverrides] = useState<Map<string, string | null>>(new Map());

  // Fetch member status when admin
  useEffect(() => {
    if (!isAdmin || !communityId) return;
    fetch(`/api/communities/${communityId}/admin/profiles`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.nodes) return;
        const map = new Map<string, AdminProfileNode>();
        for (const n of data.nodes as AdminProfileNode[]) map.set(n.id, n);
        setAdminNodes(map);
      })
      .catch(() => {});
  }, [isAdmin, communityId]);

  const isEditable = useCallback((nodeId: string) => {
    if (!isAdmin || !editMode) return false;
    const an = adminNodes.get(nodeId);
    return !!an && !an.isMember;
  }, [isAdmin, editMode, adminNodes]);

  const openProfileCell = useCallback((nodeId: string, field: string, e: React.MouseEvent) => {
    if (!isEditable(nodeId)) return;
    e.stopPropagation();
    setProfileCell({ nodeId, field });
  }, [isEditable]);

  const closeProfileCell = useCallback(() => setProfileCell(null), []);

  // Commit a profile-cell edit. The value comes from the editor's local draft,
  // not parent state, so this stays identity-stable while the user types.
  const commitProfileCell = useCallback(async (nodeId: string, field: string, value: string) => {
    if (!communityId) return;
    const fields: Record<string, unknown> = field === 'tags'
      ? { tags: value.split(',').map(t => t.trim()).filter(Boolean) }
      : { [field]: value };
    try {
      const res = await patchAdminProfile(communityId, nodeId, fields);
      if (res.ok) {
        const data = await res.json();
        setAdminNodes(prev => {
          const next = new Map(prev);
          const existing = next.get(nodeId);
          if (existing) next.set(nodeId, {
            ...existing,
            name: data.node?.name ?? existing.name,
            subtitle: data.node?.subtitle ?? undefined,
            location: data.node?.location ?? undefined,
            url: data.node?.url ?? undefined,
            tags: data.node?.tags ?? existing.tags,
          });
          return next;
        });
        // Reflect person-field edits in the underlying items/graph.
        onDataChanged?.();
      }
    } finally {
      setProfileCell(null);
    }
  }, [communityId, onDataChanged]);

  const saveAlias = useCallback(async (nodeId: string, alias: string | null) => {
    if (!communityId) return;
    setAliasEditNodeId(null);
    setAliasOverrides(prev => new Map(prev).set(nodeId, alias));
    try {
      const res = await patchAdminProfile(communityId, nodeId, { alias });
      if (res.ok) {
        setAdminNodes(prev => {
          const next = new Map(prev);
          const existing = next.get(nodeId);
          if (existing) next.set(nodeId, { ...existing, alias: alias ?? null });
          return next;
        });
      }
    } catch { /* ignore */ }
  }, [communityId]);

  // Person aliases for the type dropdown
  const personAliases = useMemo(() => aliasesForType(communityAliases, 'Person'), [communityAliases]);

  // Close alias dropdown on outside click
  useEffect(() => {
    if (!aliasEditNodeId) return;
    const handler = () => setAliasEditNodeId(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [aliasEditNodeId]);

  const triggerImageUpload = useCallback((nodeId: string, e: React.MouseEvent) => {
    if (!isEditable(nodeId)) return;
    e.stopPropagation();
    profileFileTarget.current = nodeId;
    profileFileRef.current?.click();
  }, [isEditable]);

  const handleProfileFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const nodeId = profileFileTarget.current;
    e.target.value = '';
    if (!file || !nodeId || !communityId) return;
    const err = validateImageFile(file);
    if (err) return;
    setTableCropperState({ file, nodeId });
  };

  const handleTableCroppedUpload = async (blob: Blob) => {
    if (!tableCropperState || !communityId) return;
    const { nodeId } = tableCropperState;
    setUploadingId(nodeId);
    try {
      const url = await uploadCroppedImage('card', nodeId, blob, tableCropperState.file.name);
      setImageOverrides(prev => new Map(prev).set(nodeId, url));
      await patchAdminProfile(communityId, nodeId, { imageUrl: url });
      setTableCropperState(null);
      onDataChanged?.();
    } finally {
      setUploadingId(null);
    }
  };

  const toggleOpenToWork = useCallback(async (item: DirectoryItem) => {
    if (!communityId) return;
    try {
      const res = await patchAdminProfile(communityId, item.id, { openToWork: !item.openToWork });
      if (res.ok) onDataChanged?.();
    } catch { /* ignore */ }
  }, [communityId, onDataChanged]);

  // Upgrade prompt: first private column exceeding threshold that hasn't been dismissed
  const upgradeCandidate = useMemo(() => {
    if (!isAuthenticated) return null;
    return privateColumns.find(c => (privateValueCounts[c.id] || 0) >= UPGRADE_THRESHOLD && !dismissedPrompts.has(c.id)) ?? null;
  }, [privateColumns, privateValueCounts, dismissedPrompts, isAuthenticated]);

  const openAddModal = useCallback((defaultName?: string, defaultType?: CrmColumnType) => {
    setModalDefaultName(defaultName);
    setModalDefaultType(defaultType);
    setShowAddModal(true);
  }, []);

  const handleCellClick = useCallback((nodeId: string, key: string, e: React.MouseEvent) => {
    e.stopPropagation(); // don't trigger row click / sidebar
    setEditingCell({ nodeId, key });
  }, []);

  const handleCellSave = useCallback(async (nodeId: string, key: string, value: string) => {
    setEditingCell(null);
    if (key.startsWith('prv__')) {
      const columnId = key.replace('prv__', '');
      await savePrivateValue(nodeId, columnId, value);
    } else if (key.startsWith('com__')) {
      const columnKey = key.replace('com__', '');
      const col = communityColumns.find(c => c.columnKey === columnKey);
      if (col) await saveCommunityValue(nodeId, col.id, columnKey, value);
    }
  }, [savePrivateValue, communityColumns, saveCommunityValue]);

  // Read cell values through a ref so getCellValue keeps a stable identity even
  // as valueMap changes on each edit — otherwise it would defeat row memoization.
  const valueMapRef = useRef(valueMap);
  valueMapRef.current = valueMap;
  const getCellValue = useCallback((nodeId: string, key: string): string => {
    return (valueMapRef.current.values[nodeId]?.[key] as string) || '';
  }, []);

  // All CRM column definitions in display order
  const crmColumns = useMemo(() => [
    ...communityColumns.map(c => ({ id: c.id, key: comKey(c.columnKey), label: c.columnName, type: c.columnType, options: c.options, source: 'community' as const })),
    ...pendingRequests.map(r => ({ id: r.id, key: `pend__${r.id}`, label: r.columnName, type: r.columnType, options: null, source: 'pending' as const })),
    ...privateColumns.map(c => ({ id: c.id, key: prvKey(c.id), label: c.columnName, type: c.columnType, options: c.options, source: 'private' as const })),
  ], [communityColumns, pendingRequests, privateColumns]);

  const profileColumns = useMemo(() => getProfileColumns(activeType), [activeType]);

  // Fixed-layout column widths (px), in render order: Name, Type, profile cols,
  // CRM cols, then the add-column spacer. `tags` gets extra room since it wraps.
  const columnWidths = useMemo(() => {
    const widths = [230, 130];
    for (const col of profileColumns) widths.push(col.key === 'tags' ? 220 : 168);
    for (let i = 0; i < crmColumns.length; i++) widths.push(168);
    widths.push(110);
    return widths;
  }, [profileColumns, crmColumns]);

  // Stable per-row context for the virtualized rows.
  const rowContext = useMemo<RowContext>(() => ({
    editMode,
    isEditable,
    isMember: (id: string) => adminNodes.get(id)?.isMember ?? false,
    onRowClick,
    columnWidths,
  }), [editMode, isEditable, adminNodes, onRowClick, columnWidths]);

  // Every function a row needs, bundled into one identity-stable object so the
  // row's arePropsEqual can compare it with a single reference check. Nothing
  // here depends on per-keystroke state, so the bundle stays stable while a
  // user types in a cell.
  const rowHandlers = useMemo(() => ({
    isEditable,
    triggerImageUpload,
    openProfileCell,
    commitProfileCell,
    closeProfileCell,
    setAliasEditNodeId,
    saveAlias,
    toggleOpenToWork,
    handleCellClick,
    handleCellSave,
    setEditingCell,
    getCellValue,
    shareValueWithCommunity,
  }), [
    isEditable, triggerImageUpload, openProfileCell, commitProfileCell, closeProfileCell,
    saveAlias, toggleOpenToWork, handleCellClick, handleCellSave, getCellValue,
    shareValueWithCommunity,
  ]);

  // ── Header (rendered once, sticky) ─────────────────────────────────────────
  const renderHeader = useCallback(() => (
    <tr>
      {/* Standard columns */}
      <th className="px-4 py-2.5 text-left text-xs font-medium text-text-muted uppercase tracking-wider whitespace-nowrap bg-surface-2 border-b border-border-default">Name</th>
      <th className="px-4 py-2.5 text-left text-xs font-medium text-text-muted uppercase tracking-wider whitespace-nowrap bg-surface-2 border-b border-border-default">Type</th>
      {profileColumns.map(col => (
        <th key={col.key} className="px-4 py-2.5 text-left text-xs font-medium text-text-muted uppercase tracking-wider whitespace-nowrap bg-surface-2 border-b border-border-default">
          {col.label}
        </th>
      ))}

      {/* CRM columns */}
      {crmColumns.map(col => (
        <th key={col.key} className="px-4 py-2.5 text-left text-xs font-medium text-text-muted uppercase tracking-wider whitespace-nowrap bg-surface-2 border-b border-border-default">
          <div className="flex items-center gap-1.5">
            <span className={col.source === 'pending' ? 'opacity-50' : ''}>{col.label}</span>
            {col.source === 'private' && (
              <button
                onClick={() => removePrivateColumn(col.id)}
                className="ml-1 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:text-red-500 transition-colors"
                title="Remove column"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </th>
      ))}

      {/* Add column button */}
      <th className="px-4 py-2.5 text-left bg-surface-2 border-b border-border-default">
        <button
          onClick={() => openAddModal()}
          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-text-muted rounded-lg border border-dashed border-border-default hover:border-brand-green hover:text-brand-green hover:bg-brand-green/5 transition-colors whitespace-nowrap"
        >
          <Plus className="w-3 h-3" /> Add column
        </button>
      </th>
    </tr>
  ), [profileColumns, crmColumns, removePrivateColumn, openAddModal]);

  // ── Row cells ──────────────────────────────────────────────────────────────
  // The row body lives in DirectoryRowCells (memoized); this thin closure wires
  // it to the table's local state/handlers.
  const renderCells = (item: DirectoryItem) => (
    <DirectoryRowCells
      item={item}
      profileCell={profileCell}
      editingCell={editingCell}
      adminNodes={adminNodes}
      imageOverrides={imageOverrides}
      aliasOverrides={aliasOverrides}
      aliasEditNodeId={aliasEditNodeId}
      uploadingId={uploadingId}
      valueMap={valueMap}
      crmColumns={crmColumns}
      profileColumns={profileColumns}
      personAliases={personAliases}
      communityAliases={communityAliases}
      nodeTypes={nodeTypes}
      communityId={communityId}
      isAuthenticated={isAuthenticated}
      editMode={editMode}
      handlers={rowHandlers}
    />
  );

  if (loading || columnsLoading) return <DirectoryTableSkeleton extraColumns={profileColumns.length + crmColumns.length} />;
  if (items.length === 0) return <EmptyState title="No entries" description="No entries found. Try adjusting your filters." />;

  return (
    <div className="space-y-3">
      {/* Upgrade prompt */}
      {upgradeCandidate && (
        <RequestUpgradePrompt
          columnName={upgradeCandidate.columnName}
          filledCount={privateValueCounts[upgradeCandidate.id] || 0}
          onRequest={() => {
            openAddModal(upgradeCandidate.columnName, upgradeCandidate.columnType as CrmColumnType);
            setDismissedPrompts(prev => new Set([...prev, upgradeCandidate.id]));
          }}
          onDismiss={() => setDismissedPrompts(prev => new Set([...prev, upgradeCandidate.id]))}
        />
      )}

      {/* Table — only on-screen rows are mounted (window-scrolled virtualization).
          `relative` anchors the floating cell highlight; mousemove drives it
          imperatively without re-rendering. */}
      <div
        ref={cardRef}
        className="relative w-full bg-surface-1 border border-border-default rounded-2xl shadow-soft overflow-hidden"
        onMouseMove={e => scheduleOverlay((e.target as HTMLElement).closest('td') as HTMLElement | null)}
        onMouseLeave={() => scheduleOverlay(null)}
      >
        <TableVirtuoso
          useWindowScroll
          data={items}
          context={rowContext}
          components={tableComponents}
          computeItemKey={(_, item) => item.id}
          fixedHeaderContent={renderHeader}
          itemContent={(_, item) => renderCells(item)}
          // Track the on-screen row range to drive windowed value load + eviction.
          rangeChanged={handleRangeChanged}
          // Render ~600px of rows above/below the viewport so fast scrolling
          // doesn't reveal blank gaps before the next rows mount.
          increaseViewportBy={{ top: 600, bottom: 600 }}
        />

        {/* Floating cell highlight (positioned imperatively over the hovered td) */}
        <div
          ref={cellOverlayRef}
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 z-10 rounded-[3px] opacity-0 transition-all duration-200 will-change-transform"
          style={{
            boxShadow: 'inset 0 0 0 1.5px var(--color-brand-green)',
            backgroundColor: 'rgba(120, 216, 112, 0.07)',
            transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        />

        {/* Column remove bar — shows on hover for private columns */}
        {privateColumns.length > 0 && (
          <div className="border-t border-border-subtle px-4 py-2 bg-surface-2/50 flex items-center gap-3 flex-wrap">
            {privateColumns.map(col => (
              <button
                key={col.id}
                onClick={() => removePrivateColumn(col.id)}
                className="flex items-center gap-1.5 text-xs text-text-muted hover:text-red-600 transition-colors"
              >
                <Lock className="w-3 h-3" />
                {col.columnName}
                <X className="w-3 h-3" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Add Column Modal */}
      <AddColumnModal
        isOpen={showAddModal}
        onClose={() => { setShowAddModal(false); setModalDefaultName(undefined); setModalDefaultType(undefined); }}
        onAddPrivate={addPrivateColumn}
        onRequestCommunity={requestCommunityColumn}
        isAuthenticated={isAuthenticated}
        defaultName={modalDefaultName}
        defaultType={modalDefaultType}
      />

      {/* Hidden file input for profile image upload */}
      <input ref={profileFileRef} type="file" accept="image/*" className="hidden" onChange={handleProfileFileChange} />

      {/* Image Cropper Modal for inline table uploads */}
      {tableCropperState && (() => {
        const cropItem = items.find(i => i.id === tableCropperState.nodeId);
        return (
          <ImageCropper
            imageFile={tableCropperState.file}
            onCrop={handleTableCroppedUpload}
            onCancel={() => setTableCropperState(null)}
            isUploading={uploadingId === tableCropperState.nodeId}
            previewName={cropItem?.name}
          />
        );
      })()}
    </div>
  );
}
