'use client';

import React from 'react';
import { Loader2, Upload, Plus, Share2 } from 'lucide-react';
import type { AdminProfileNode } from '@/app/api/communities/[communityId]/admin/profiles/route';
import type { DirectoryItem } from '@/components/dashboard/types';
import type { NodeTypeConfig, CommunityAlias } from '@/lib/types';
import { getNodeTypeConfig, findAlias } from '@/lib/types';
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

// Every function a row needs, bundled into one object with a stable identity
// (built once via useMemo in the parent). Passing them as a single reference
// lets arePropsEqual compare them with one identity check instead of ~14, and
// removes the "add a handler, forget to compare it" drift footgun.
interface RowHandlers {
  isEditable: (id: string) => boolean;
  triggerImageUpload: (nodeId: string, e: React.MouseEvent) => void;
  openProfileCell: (nodeId: string, field: string, e: React.MouseEvent) => void;
  commitProfileCell: (nodeId: string, field: string, value: string) => Promise<void>;
  closeProfileCell: () => void;
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

interface DirectoryRowCellsProps {
  item: DirectoryItem;
  // Per-row state slices (compared by per-node identity in arePropsEqual)
  profileCell: { nodeId: string; field: string } | null;
  editingCell: { nodeId: string; key: string } | null;
  adminNodes: Map<string, AdminProfileNode>;
  imageOverrides: Map<string, string>;
  aliasOverrides: Map<string, string | null>;
  aliasEditNodeId: string | null;
  uploadingId: string | null;
  valueMap: CrmValueMap;
  // Table-wide config (identity-stable unless it truly changes)
  crmColumns: CrmColumn[];
  profileColumns: ProfileColumn[];
  personAliases: CommunityAlias[];
  communityAliases?: CommunityAlias[];
  nodeTypes?: NodeTypeConfig[];
  communityId: string | null | undefined;
  isAuthenticated: boolean;
  editMode: boolean;
  // Stable handler bundle
  handlers: RowHandlers;
}

// Memoized row body extracted from CrmDirectoryTable's renderCells closure.
function DirectoryRowCells({
  item,
  profileCell,
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
  handlers,
}: DirectoryRowCellsProps) {
  const {
    isEditable, triggerImageUpload, openProfileCell, commitProfileCell, closeProfileCell,
    saveAlias, setAliasEditNodeId, toggleOpenToWork, handleCellClick, handleCellSave,
    setEditingCell, getCellValue, shareValueWithCommunity,
  } = handlers;
  const editable = isEditable(item.id);
  const adminNode = adminNodes.get(item.id);
  const isMemberRow = adminNode?.isMember ?? false;
  const imgSrc = imageOverrides.get(item.id) ?? item.image_url;

  return (
    <>
      {/* Name + photo */}
      <td className="px-4 py-2.5 whitespace-nowrap">
        <div className="flex items-center gap-3">
          {/* Photo — clickable in edit mode */}
          <div
            className={`relative flex-shrink-0 h-8 w-8 rounded-full overflow-hidden group/img ${editable ? 'cursor-pointer' : ''}`}
            onClick={editable ? e => triggerImageUpload(item.id, e) : undefined}
          >
            {imgSrc ? (
              <img src={imgSrc} alt={item.name} loading="lazy" decoding="async" className="h-8 w-8 object-cover" />
            ) : (
              <div className="h-8 w-8 flex items-center justify-center text-sm font-semibold text-white" style={{ backgroundColor: getTypeColor(item.type) }}>
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
              <CellEditor
                value={item.name}
                type="text"
                onSave={value => commitProfileCell(item.id, 'name', value)}
                onCancel={closeProfileCell}
                className="text-sm font-medium text-text-primary bg-transparent border-b border-brand-green outline-none w-full min-w-[120px] pb-0.5"
              />
            ) : (
              <div
                className={`text-sm font-medium text-text-primary truncate ${editable ? 'hover:bg-brand-green/10 rounded px-1 -mx-1 cursor-text' : ''}`}
                onClick={editable ? e => openProfileCell(item.id, 'name', e) : undefined}
              >
                {item.name}
              </div>
            )}
          </div>
        </div>
      </td>

      {/* Type / Alias — editable for admin */}
      <td className="px-4 py-2.5 whitespace-nowrap relative">
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
          const aliasConfig = findAlias(communityAliases, displayAlias, item.type);
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
            className={`px-4 py-2.5 ${col.key === 'tags' ? '' : 'whitespace-nowrap'} ${isEditableField || isToggleable ? 'cursor-pointer' : ''}`}
            onClick={
              isToggleable
                ? e => { e.stopPropagation(); toggleOpenToWork(item); }
                : isEditableField
                  ? e => openProfileCell(item.id, editField, e)
                  : undefined
            }
            title={isMemberRow ? `Managed by ${item.name}` : undefined}
          >
            {isEditableField && profileCell?.nodeId === item.id && profileCell.field === editField ? (
              <CellEditor
                value={currentVal}
                type="text"
                placeholder={col.key === 'tags' ? 'tag1, tag2' : undefined}
                onSave={value => commitProfileCell(item.id, editField, value)}
                onCancel={closeProfileCell}
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
            className="px-4 py-2.5 whitespace-nowrap"
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
      <td className="px-4 py-2.5" />
    </>
  );
}

// Per-row equality check. The parent (`CrmDirectoryTable`) holds table-wide
// state (valueMap, adminNodes, image/alias overrides, the edited cell, …) that
// changes on every interaction; a shallow comparison would re-render *every*
// mounted row on each keystroke or hover. Instead we compare only the slices
// that affect THIS row (keyed by item.id), relying on the parent's setters
// preserving per-node object identity for untouched rows. All handlers travel
// in one stable useMemo'd bundle, so a single identity check covers them all.
function arePropsEqual(prev: DirectoryRowCellsProps, next: DirectoryRowCellsProps): boolean {
  const id = next.item.id;

  if (prev.item !== next.item) return false;

  // Per-row data
  if (prev.valueMap.values[id] !== next.valueMap.values[id]) return false;
  if (prev.valueMap.contributors[id] !== next.valueMap.contributors[id]) return false;
  if (prev.adminNodes.get(id) !== next.adminNodes.get(id)) return false;
  if (prev.imageOverrides.get(id) !== next.imageOverrides.get(id)) return false;
  if (prev.aliasOverrides.has(id) !== next.aliasOverrides.has(id)) return false;
  if (prev.aliasOverrides.get(id) !== next.aliasOverrides.get(id)) return false;

  // Row-targeted single-value selections
  if ((prev.aliasEditNodeId === id) !== (next.aliasEditNodeId === id)) return false;
  if ((prev.uploadingId === id) !== (next.uploadingId === id)) return false;

  // Profile cell editor — re-render only when the OPEN cell for this row
  // changes (open / close / switch field). The CellEditor keeps its own draft,
  // so keystrokes stay local and never reach the row.
  const prevPC = prev.profileCell?.nodeId === id ? prev.profileCell : null;
  const nextPC = next.profileCell?.nodeId === id ? next.profileCell : null;
  if (prevPC !== nextPC) {
    if (!prevPC || !nextPC) return false;
    if (prevPC.field !== nextPC.field) return false;
  }

  // CRM cell editor — only matters when it targets this row
  const prevEC = prev.editingCell?.nodeId === id ? prev.editingCell : null;
  const nextEC = next.editingCell?.nodeId === id ? next.editingCell : null;
  if (prevEC !== nextEC) {
    if (!prevEC || !nextEC) return false;
    if (prevEC.key !== nextEC.key) return false;
  }

  // Table-wide slices (identity-stable across renders unless they truly change)
  if (
    prev.crmColumns !== next.crmColumns ||
    prev.profileColumns !== next.profileColumns ||
    prev.personAliases !== next.personAliases ||
    prev.communityAliases !== next.communityAliases ||
    prev.nodeTypes !== next.nodeTypes ||
    prev.communityId !== next.communityId ||
    prev.isAuthenticated !== next.isAuthenticated ||
    prev.editMode !== next.editMode
  ) return false;

  // All handlers travel in one stable, useMemo'd bundle — a single identity
  // check covers every one of them.
  return prev.handlers === next.handlers;
}

export default React.memo(DirectoryRowCells, arePropsEqual);
