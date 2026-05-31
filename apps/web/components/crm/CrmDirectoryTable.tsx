'use client';

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { TableVirtuoso, type TableComponents } from 'react-virtuoso';
import { Lock, Globe, Clock, Plus, X, User } from 'lucide-react';
import { uploadCroppedImage, validateImageFile } from '@/lib/imageUpload';
import ImageCropper from '@/components/data/ImageCropper';
import type { AdminProfileNode } from '@/app/api/communities/[communityId]/admin/profiles/route';
import type { DirectoryItem } from '@/components/dashboard/types';
import type { NodeTypeConfig, CommunityAlias } from '@/lib/types';
import { EmptyState, Skeleton } from '@/components/ui';
import { useCrmColumns, prvKey, comKey, CrmColumnType } from '@/hooks/useCrmColumns';
import { patchAdminProfile } from '@/lib/crm/adminProfileApi';
import AddColumnModal from './AddColumnModal';
import RequestUpgradePrompt from './RequestUpgradePrompt';
import DirectoryRowCells from './DirectoryRowCells';
import { getProfileColumns } from './profileColumns';

const UPGRADE_THRESHOLD = 3;

function DirectoryTableSkeleton({ extraColumns = 4 }: { extraColumns?: number }) {
  // Always render at least name + type + a few extras so the skeleton looks like the real table
  const colCount = Math.max(4, 2 + extraColumns);
  return (
    <div className="w-full bg-surface-1 border border-border-subtle rounded-lg overflow-hidden">
      <div className="overflow-x-auto w-full">
        <table className="w-full divide-y divide-border-subtle">
          <thead className="bg-surface-2">
            <tr>
              {Array.from({ length: colCount }).map((_, i) => (
                <th key={i} className="px-6 py-3 text-left">
                  <Skeleton className="h-3 w-20" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-surface-1 divide-y divide-border-subtle">
            {Array.from({ length: 8 }).map((_, rowIdx) => (
              <tr key={rowIdx}>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-10 w-10 rounded-xl" />
                    <Skeleton className="h-3.5 w-32" />
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <Skeleton className="h-5 w-16 rounded-full" />
                </td>
                {Array.from({ length: colCount - 2 }).map((_, i) => (
                  <td key={i} className="px-6 py-4 whitespace-nowrap">
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
}

type CtxProp = { context?: RowContext };

// react-virtuoso types each `TableComponents` slot with its own internal prop
// shapes (item/context + data-index plumbing) that these hand-written components
// don't structurally satisfy (verified: a `satisfies` check fails even with a
// single @types/react in the tree — it isn't a duplicate-types issue). The
// per-component param types above keep each body type-safe; only the assembled
// map is cast.
const tableComponents = {
  Scroller: React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'> & CtxProp>(
    function Scroller({ context: _context, ...props }, ref) {
      return <div ref={ref} {...props} className="overflow-x-auto w-full" />;
    }
  ),
  Table: ({ context: _context, style, ...props }: React.ComponentPropsWithoutRef<'table'> & CtxProp) => (
    <table {...props} style={{ ...style, tableLayout: 'auto' }} className="w-full divide-y divide-border-subtle" />
  ),
  TableHead: React.forwardRef<HTMLTableSectionElement, React.ComponentPropsWithoutRef<'thead'> & CtxProp>(
    function TableHead({ context: _context, ...props }, ref) {
      return <thead {...props} ref={ref} className="bg-surface-2" />;
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
        className={`transition-colors duration-150 group ${ctx.editMode ? (editable ? 'cursor-default' : 'cursor-default opacity-60') : 'hover:bg-surface-2 cursor-pointer'}`}
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
  const nodeIds = useMemo(() => items.map(i => i.id), [items]);

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

  // Profile inline editing state
  const [profileCell, setProfileCell] = useState<{ nodeId: string; field: string; value: string } | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
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

  const openProfileCell = (nodeId: string, field: string, current: string, e: React.MouseEvent) => {
    if (!isEditable(nodeId)) return;
    e.stopPropagation();
    setProfileCell({ nodeId, field, value: current });
  };

  const saveProfileCell = async () => {
    if (!profileCell || !communityId) return;
    const { nodeId, field, value } = profileCell;
    setProfileSaving(true);
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
      setProfileSaving(false);
      setProfileCell(null);
    }
  };

  const handleProfileKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); saveProfileCell(); }
    if (e.key === 'Escape') { e.preventDefault(); setProfileCell(null); }
  };

  const saveAlias = async (nodeId: string, alias: string | null) => {
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
  };

  // Person aliases for the type dropdown
  const personAliases = useMemo(() =>
    (communityAliases ?? []).filter(a => a.nodeType === 'Person'),
  [communityAliases]);

  // Close alias dropdown on outside click
  useEffect(() => {
    if (!aliasEditNodeId) return;
    const handler = () => setAliasEditNodeId(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [aliasEditNodeId]);

  const triggerImageUpload = (nodeId: string, e: React.MouseEvent) => {
    if (!isEditable(nodeId)) return;
    e.stopPropagation();
    profileFileTarget.current = nodeId;
    profileFileRef.current?.click();
  };

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

  const toggleOpenToWork = async (item: DirectoryItem) => {
    if (!communityId) return;
    try {
      const res = await patchAdminProfile(communityId, item.id, { openToWork: !item.openToWork });
      if (res.ok) onDataChanged?.();
    } catch { /* ignore */ }
  };

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

  const handleCellClick = (nodeId: string, key: string, e: React.MouseEvent) => {
    e.stopPropagation(); // don't trigger row click / sidebar
    setEditingCell({ nodeId, key });
  };

  const handleCellSave = async (nodeId: string, key: string, value: string) => {
    setEditingCell(null);
    if (key.startsWith('prv__')) {
      const columnId = key.replace('prv__', '');
      await savePrivateValue(nodeId, columnId, value);
    } else if (key.startsWith('com__')) {
      const columnKey = key.replace('com__', '');
      const col = communityColumns.find(c => c.columnKey === columnKey);
      if (col) await saveCommunityValue(nodeId, col.id, columnKey, value);
    }
  };

  const getCellValue = (nodeId: string, key: string): string => {
    return (valueMap.values[nodeId]?.[key] as string) || '';
  };

  // All CRM column definitions in display order
  const crmColumns = useMemo(() => [
    ...communityColumns.map(c => ({ id: c.id, key: comKey(c.columnKey), label: c.columnName, type: c.columnType, options: c.options, source: 'community' as const })),
    ...pendingRequests.map(r => ({ id: r.id, key: `pend__${r.id}`, label: r.columnName, type: r.columnType, options: null, source: 'pending' as const })),
    ...privateColumns.map(c => ({ id: c.id, key: prvKey(c.id), label: c.columnName, type: c.columnType, options: c.options, source: 'private' as const })),
  ], [communityColumns, pendingRequests, privateColumns]);

  const profileColumns = useMemo(() => getProfileColumns(activeType), [activeType]);

  // Stable per-row context for the virtualized rows.
  const rowContext = useMemo<RowContext>(() => ({
    editMode,
    isEditable,
    isMember: (id: string) => adminNodes.get(id)?.isMember ?? false,
    onRowClick,
  }), [editMode, isEditable, adminNodes, onRowClick]);

  // ── Header (rendered once, sticky) ─────────────────────────────────────────
  const renderHeader = useCallback(() => (
    <tr>
      {/* Standard columns */}
      <th className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider whitespace-nowrap bg-surface-2">Name</th>
      <th className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider whitespace-nowrap bg-surface-2">Type</th>
      {profileColumns.map(col => (
        <th key={col.key} className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider whitespace-nowrap bg-surface-2">
          <div className="flex items-center gap-1.5">
            <User className="w-3 h-3 text-emerald-400" />
            <span>{col.label}</span>
          </div>
        </th>
      ))}

      {/* CRM columns */}
      {crmColumns.map(col => (
        <th key={col.key} className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider whitespace-nowrap bg-surface-2">
          <div className="flex items-center gap-1.5">
            {col.source === 'private' && <Lock className="w-3 h-3 text-blue-400" />}
            {col.source === 'community' && <Globe className="w-3 h-3 text-purple-400" />}
            {col.source === 'pending' && <Clock className="w-3 h-3 text-amber-400" />}
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
      <th className="px-3 py-3 text-left bg-surface-2">
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
      profileSaving={profileSaving}
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
      isEditable={isEditable}
      triggerImageUpload={triggerImageUpload}
      openProfileCell={openProfileCell}
      saveProfileCell={saveProfileCell}
      handleProfileKeyDown={handleProfileKeyDown}
      setProfileCell={setProfileCell}
      setAliasEditNodeId={setAliasEditNodeId}
      saveAlias={saveAlias}
      toggleOpenToWork={toggleOpenToWork}
      handleCellClick={handleCellClick}
      handleCellSave={handleCellSave}
      setEditingCell={setEditingCell}
      getCellValue={getCellValue}
      shareValueWithCommunity={shareValueWithCommunity}
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

      {/* Table — only on-screen rows are mounted (window-scrolled virtualization) */}
      <div className="w-full bg-surface-1 border border-border-subtle rounded-lg overflow-hidden">
        <TableVirtuoso
          useWindowScroll
          data={items}
          context={rowContext}
          components={tableComponents}
          computeItemKey={(_, item) => item.id}
          fixedHeaderContent={renderHeader}
          itemContent={(_, item) => renderCells(item)}
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
