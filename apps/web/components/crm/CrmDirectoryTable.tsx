'use client';

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Lock, Globe, Clock, Plus, X, Loader2, Upload, User, Share2 } from 'lucide-react';
import { uploadCroppedImage, validateImageFile } from '@/lib/imageUpload';
import ImageCropper from '@/components/data/ImageCropper';
import type { AdminProfileNode } from '@/app/api/communities/[communityId]/admin/profiles/route';
import type { DirectoryItem } from '@/components/dashboard/types';
import type { NodeTypeConfig, CommunityAlias } from '@/lib/types';
import { getNodeTypeConfig } from '@/lib/types';
import { getTypeColor } from '@/components/dashboard/typeStyles';
import { getInitials } from '@/components/dashboard/utils';
import { Badge, LoadingText, EmptyState } from '@/components/ui';
import { useCrmColumns, prvKey, comKey, CrmColumnType } from '@/hooks/useCrmColumns';
import AddColumnModal from './AddColumnModal';
import RequestUpgradePrompt from './RequestUpgradePrompt';
import CellEditor from './CellEditor';
import { getProfileColumns, renderProfileCell } from './profileColumns';

const UPGRADE_THRESHOLD = 3;

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

  const isEditable = (nodeId: string) => {
    if (!isAdmin || !editMode) return false;
    const an = adminNodes.get(nodeId);
    return !!an && !an.isMember;
  };

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
      const res = await fetch(`/api/communities/${communityId}/admin/profiles`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId, fields }),
      });
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
        // Update the items array for person-specific fields displayed via metadata
        if (data.person) {
          // Force a refresh by updating the item in-place via the onRowClick pattern
          // The graph cache will be invalidated server-side (revalidateTag)
        }
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
      const res = await fetch(`/api/communities/${communityId}/admin/profiles`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId, fields: { alias } }),
      });
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
      await fetch(`/api/communities/${communityId}/admin/profiles`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId, fields: { imageUrl: url } }),
      });
      setTableCropperState(null);
      onDataChanged?.();
    } finally {
      setUploadingId(null);
    }
  };
  // For fade-in animation
  const [visibleCount, setVisibleCount] = useState(0);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const prevIdsKeyRef = useRef('');

  // Stagger rows in on new data (matches original NodeTable behaviour)
  useEffect(() => {
    const idsKey = items.map(i => i.id).join(',');
    if (idsKey === prevIdsKeyRef.current) return;
    prevIdsKeyRef.current = idsKey;
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
    setVisibleCount(0);
    items.forEach((_, i) => {
      const t = setTimeout(() => setVisibleCount(i + 1), i * 40);
      timeoutsRef.current.push(t);
    });
    return () => { timeoutsRef.current.forEach(clearTimeout); prevIdsKeyRef.current = ''; };
  }, [items]);

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

  if (loading || columnsLoading) return <LoadingText text="Loading directory…" />;
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

      {/* Table */}
      <div className="w-full bg-surface-1 border border-border-subtle rounded-lg overflow-hidden">
        <div className="overflow-x-auto w-full">
          <table className="w-full divide-y divide-border-subtle" style={{ tableLayout: 'auto' }}>
            <thead className="bg-surface-2">
              <tr>
                {/* Standard columns */}
                <th className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider whitespace-nowrap">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider whitespace-nowrap">Type</th>
                {profileColumns.map(col => (
                  <th key={col.key} className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <User className="w-3 h-3 text-emerald-400" />
                      <span>{col.label}</span>
                    </div>
                  </th>
                ))}

                {/* CRM columns */}
                {crmColumns.map(col => (
                  <th key={col.key} className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider whitespace-nowrap">
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
                <th className="px-3 py-3 text-left">
                  <button
                    onClick={() => openAddModal()}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-text-muted rounded-lg border border-dashed border-border-default hover:border-brand-green hover:text-brand-green hover:bg-brand-green/5 transition-colors whitespace-nowrap"
                  >
                    <Plus className="w-3 h-3" /> Add column
                  </button>
                </th>

              </tr>
            </thead>

            <tbody className="bg-surface-1 divide-y divide-border-subtle">
              {items.map((item, i) => {
                const editable = isEditable(item.id);
                const adminNode = adminNodes.get(item.id);
                const isMemberRow = adminNode?.isMember ?? false;
                const imgSrc = imageOverrides.get(item.id) ?? item.image_url;

                return (
                <tr
                  key={item.id}
                  className={`transition-colors duration-150 group ${editMode ? (editable ? 'cursor-default' : 'cursor-default opacity-60') : 'hover:bg-surface-2 cursor-pointer'}`}
                  onClick={editMode ? undefined : () => onRowClick?.(item)}
                  style={{
                    opacity: i < visibleCount ? (editMode && isMemberRow ? 0.5 : 1) : 0,
                    transform: i < visibleCount ? 'translateX(0)' : 'translateX(32px)',
                    transition: 'opacity 0.3s ease-out, transform 0.3s ease-out',
                  }}
                >
                  {/* Name + photo */}
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      {/* Photo — clickable in edit mode */}
                      <div
                        className={`relative flex-shrink-0 h-10 w-10 rounded-xl overflow-hidden group/img ${editable ? 'cursor-pointer' : ''}`}
                        onClick={editable ? e => triggerImageUpload(item.id, e) : undefined}
                      >
                        {imgSrc ? (
                          <img src={imgSrc} alt={item.name} className="h-10 w-10 object-cover" />
                        ) : (
                          <div className="h-10 w-10 flex items-center justify-center text-sm font-semibold text-white" style={{ backgroundColor: getTypeColor(item.type) }}>
                            {getInitials(item.name)}
                          </div>
                        )}
                        {editable && (
                          uploadingId === item.id ? (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                              <Loader2 className="w-4 h-4 text-white animate-spin" />
                            </div>
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover/img:opacity-100 transition-opacity">
                              <Upload className="w-3.5 h-3.5 text-white" />
                            </div>
                          )
                        )}
                      </div>

                      {/* Name — inline editable */}
                      <div className="min-w-0">
                        {editable && profileCell?.nodeId === item.id && profileCell.field === 'name' ? (
                          <input
                            autoFocus
                            value={profileCell.value}
                            onChange={e => setProfileCell(p => p ? { ...p, value: e.target.value } : p)}
                            onBlur={saveProfileCell}
                            onKeyDown={handleProfileKeyDown}
                            disabled={profileSaving}
                            className="text-sm font-medium text-text-primary bg-transparent border-b border-brand-green outline-none w-full min-w-[120px] pb-0.5"
                          />
                        ) : (
                          <div
                            className={`text-sm font-medium text-text-primary truncate ${editable ? 'hover:bg-brand-green/10 rounded px-1 -mx-1 cursor-text' : ''}`}
                            onClick={editable ? e => openProfileCell(item.id, 'name', item.name, e) : undefined}
                          >
                            {item.name}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Type / Alias — editable for admin */}
                  <td className="px-6 py-4 whitespace-nowrap relative">
                    {editable && !isMemberRow && aliasEditNodeId === item.id ? (
                      <div className="absolute z-20 top-full left-4 mt-1 bg-surface-1 border border-border-subtle rounded-lg shadow-lg py-1 min-w-[140px]"
                        onClick={e => e.stopPropagation()}
                      >
                        {/* Person (no alias) */}
                        {(() => {
                          const currentAlias = aliasOverrides.has(item.id) ? aliasOverrides.get(item.id) : item.alias;
                          return (
                            <>
                              <button
                                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-surface-2 ${!currentAlias ? 'font-semibold' : ''}`}
                                onClick={() => saveAlias(item.id, null)}
                              >
                                <Badge variant="type-pill" color={getNodeTypeConfig('Person', nodeTypes).color}>Person</Badge>
                              </button>
                              {personAliases.map(a => (
                                <button
                                  key={a.name}
                                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-surface-2 ${currentAlias === a.name ? 'font-semibold' : ''}`}
                                  onClick={() => saveAlias(item.id, a.name)}
                                >
                                  <Badge variant="type-pill" color={a.color}>{a.name}</Badge>
                                </button>
                              ))}
                            </>
                          );
                        })()}
                      </div>
                    ) : null}
                    {(() => {
                      const displayAlias = aliasOverrides.has(item.id) ? aliasOverrides.get(item.id) : item.alias;
                      const aliasConfig = displayAlias ? (communityAliases ?? []).find(a => a.name === displayAlias && a.nodeType === item.type) : undefined;
                      const color = aliasConfig?.color ?? getNodeTypeConfig(item.type, nodeTypes).color;
                      return (
                        <div
                          className={editable && !isMemberRow ? 'cursor-pointer hover:opacity-80' : ''}
                          onClick={editable && !isMemberRow ? e => { e.stopPropagation(); setAliasEditNodeId(prev => prev === item.id ? null : item.id); } : undefined}
                        >
                          <Badge variant="type-pill" color={color}>{displayAlias ?? item.type}</Badge>
                        </div>
                      );
                    })()}
                  </td>

                  {/* Type-specific profile columns (Global Public layer) */}
                  {profileColumns.map(col => {
                    const isToggle = col.key === 'openToWork';
                    const isEditableField = editable && !isMemberRow && !isToggle;
                    const isToggleable = editable && !isMemberRow && isToggle;
                    const editField = col.key as string;
                    const currentVal = col.key === 'tags'
                      ? item.tags?.join(', ') ?? ''
                      : (item[col.key] as string) ?? '';
                    return (
                      <td
                        key={col.key}
                        className={`px-6 py-4 ${col.key === 'tags' ? '' : 'whitespace-nowrap'} ${isEditableField || isToggleable ? 'cursor-pointer' : ''}`}
                        onClick={
                          isToggleable
                            ? async (e) => {
                                e.stopPropagation();
                                if (!communityId) return;
                                await fetch(`/api/communities/${communityId}/admin/profiles`, {
                                  method: 'PATCH',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ nodeId: item.id, fields: { openToWork: !item.openToWork } }),
                                });
                              }
                            : isEditableField
                              ? e => openProfileCell(item.id, editField, currentVal, e)
                              : undefined
                        }
                        title={isMemberRow ? `Managed by ${item.name}` : undefined}
                      >
                        {isEditableField && profileCell?.nodeId === item.id && profileCell.field === editField ? (
                          <input
                            autoFocus
                            value={profileCell.value}
                            onChange={e => setProfileCell(p => p ? { ...p, value: e.target.value } : p)}
                            onBlur={saveProfileCell}
                            onKeyDown={handleProfileKeyDown}
                            disabled={profileSaving}
                            placeholder={col.key === 'tags' ? 'tag1, tag2' : undefined}
                            className="text-sm text-text-primary bg-transparent border-b border-brand-green outline-none w-full min-w-[120px] pb-0.5"
                          />
                        ) : (
                          <div className={isEditableField ? 'hover:bg-brand-green/10 rounded px-1 -mx-1' : ''}>
                            {renderProfileCell(item, col)}
                          </div>
                        )}
                      </td>
                    );
                  })}

                  {/* CRM cells */}
                  {crmColumns.map(col => {
                    const isCrmEditing = editingCell?.nodeId === item.id && editingCell?.key === col.key;
                    const isPending = col.source === 'pending';
                    const currentValue = getCellValue(item.id, col.key);
                    const contributor = col.source === 'community'
                      ? valueMap.contributors[item.id]?.[col.key.replace('com__', '')]
                      : null;

                    return (
                      <td
                        key={col.key}
                        className="px-4 py-4 whitespace-nowrap"
                        onClick={e => !isPending && !editMode && handleCellClick(item.id, col.key, e)}
                      >
                        {isCrmEditing ? (
                          <CellEditor
                            value={currentValue}
                            type={col.type}
                            options={col.options}
                            onSave={value => handleCellSave(item.id, col.key, value)}
                            onCancel={() => setEditingCell(null)}
                          />
                        ) : isPending ? (
                          <span className="text-xs text-text-muted italic">Pending…</span>
                        ) : (
                          <div
                            className="group/cell flex items-center gap-1.5 min-w-[100px] max-w-[200px]"
                            title={contributor ? `Last updated by ${contributor.name}` : undefined}
                          >
                            {currentValue ? (
                              <>
                                <span className="text-sm text-text-primary truncate">{currentValue}</span>
                                {col.source === 'private' && communityId && (
                                  <button
                                    onClick={e => {
                                      e.stopPropagation();
                                      shareValueWithCommunity(item.id, col.key.replace('prv__', ''), col.label, col.type, currentValue, communityId);
                                    }}
                                    className="opacity-0 group-hover/cell:opacity-60 hover:!opacity-100 p-0.5 rounded hover:text-purple-500 transition-all shrink-0"
                                    title="Share with community"
                                  >
                                    <Share2 className="w-3 h-3" />
                                  </button>
                                )}
                              </>
                            ) : (
                              <span className="text-xs text-text-muted opacity-0 group-hover/cell:opacity-100 transition-opacity">
                                {isAuthenticated ? 'Click to add' : '—'}
                              </span>
                            )}
                            {!currentValue && isAuthenticated && (
                              <Plus className="w-3 h-3 text-text-muted opacity-0 group-hover/cell:opacity-60 transition-opacity shrink-0" />
                            )}
                          </div>
                        )}
                      </td>
                    );
                  })}

                  {/* Empty add-column spacer */}
                  <td className="px-3 py-4" />
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>

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
