'use client';

import React from 'react';
import { Loader2, Upload, Plus, Share2 } from 'lucide-react';
import type { AdminProfileNode } from '@/app/api/communities/[communityId]/admin/profiles/route';
import type { DirectoryItem } from '@/components/dashboard/types';
import type { NodeTypeConfig, CommunityAlias } from '@/lib/types';
import { getNodeTypeConfig } from '@/lib/types';
import { getTypeColor } from '@/components/dashboard/typeStyles';
import { getInitials } from '@/components/dashboard/utils';
import { Badge } from '@/components/ui';
import type { CrmValueMap } from '@/hooks/useCrmColumns';
import CellEditor from './CellEditor';
import { renderProfileCell, type ProfileColumn } from './profileColumns';

// CRM column definitions in display order, shared with CrmDirectoryTable.
interface CrmColumn {
  id: string;
  key: string;
  label: string;
  type: string;
  options: string[] | null;
  source: 'community' | 'pending' | 'private';
}

interface DirectoryRowCellsProps {
  item: DirectoryItem;
  // State
  profileCell: { nodeId: string; field: string; value: string } | null;
  profileSaving: boolean;
  editingCell: { nodeId: string; key: string } | null;
  adminNodes: Map<string, AdminProfileNode>;
  imageOverrides: Map<string, string>;
  aliasOverrides: Map<string, string | null>;
  aliasEditNodeId: string | null;
  uploadingId: string | null;
  valueMap: CrmValueMap;
  crmColumns: CrmColumn[];
  profileColumns: ProfileColumn[];
  personAliases: CommunityAlias[];
  communityAliases?: CommunityAlias[];
  nodeTypes?: NodeTypeConfig[];
  communityId: string | null | undefined;
  isAuthenticated: boolean;
  editMode: boolean;
  // Derived
  isEditable: (id: string) => boolean;
  // Handlers
  triggerImageUpload: (nodeId: string, e: React.MouseEvent) => void;
  openProfileCell: (nodeId: string, field: string, current: string, e: React.MouseEvent) => void;
  saveProfileCell: () => void;
  handleProfileKeyDown: (e: React.KeyboardEvent) => void;
  setProfileCell: React.Dispatch<React.SetStateAction<{ nodeId: string; field: string; value: string } | null>>;
  setAliasEditNodeId: React.Dispatch<React.SetStateAction<string | null>>;
  saveAlias: (nodeId: string, alias: string | null) => void;
  toggleOpenToWork: (item: DirectoryItem) => void;
  handleCellClick: (nodeId: string, key: string, e: React.MouseEvent) => void;
  handleCellSave: (nodeId: string, key: string, value: string) => Promise<void>;
  setEditingCell: React.Dispatch<React.SetStateAction<{ nodeId: string; key: string } | null>>;
  getCellValue: (nodeId: string, key: string) => string;
  shareValueWithCommunity: (
    nodeId: string,
    columnKey: string,
    columnName: string,
    columnType: string,
    value: string,
    targetCommunityId: string,
  ) => void;
}

// Memoized row body extracted from CrmDirectoryTable's renderCells closure.
function DirectoryRowCells({
  item,
  profileCell,
  profileSaving,
  editingCell,
  adminNodes,
  imageOverrides,
  aliasOverrides,
  aliasEditNodeId,
  uploadingId,
  valueMap,
  crmColumns,
  profileColumns,
  personAliases,
  communityAliases,
  nodeTypes,
  communityId,
  isAuthenticated,
  editMode,
  isEditable,
  triggerImageUpload,
  openProfileCell,
  saveProfileCell,
  handleProfileKeyDown,
  setProfileCell,
  setAliasEditNodeId,
  saveAlias,
  toggleOpenToWork,
  handleCellClick,
  handleCellSave,
  setEditingCell,
  getCellValue,
  shareValueWithCommunity,
}: DirectoryRowCellsProps) {
  const editable = isEditable(item.id);
  const adminNode = adminNodes.get(item.id);
  const isMemberRow = adminNode?.isMember ?? false;
  const imgSrc = imageOverrides.get(item.id) ?? item.image_url;

  return (
    <>
      {/* Name + photo */}
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="flex items-center gap-3">
          {/* Photo — clickable in edit mode */}
          <div
            className={`relative flex-shrink-0 h-10 w-10 rounded-xl overflow-hidden group/img ${editable ? 'cursor-pointer' : ''}`}
            onClick={editable ? e => triggerImageUpload(item.id, e) : undefined}
          >
            {imgSrc ? (
              <img src={imgSrc} alt={item.name} loading="lazy" decoding="async" className="h-10 w-10 object-cover" />
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
                ? e => { e.stopPropagation(); toggleOpenToWork(item); }
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
    </>
  );
}

export default React.memo(DirectoryRowCells);
