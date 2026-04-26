'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronRight, GripVertical, ArrowUpDown, ArrowUp, ArrowDown, Trash2, Camera, Loader2, Lock, Globe, Clock } from 'lucide-react';
import { uploadNodeImage, uploadCroppedNodeImage, validateImageFile } from '@/lib/imageUpload';
import ComboboxMultiSelect from './ComboboxMultiSelect';
import FilterPopover, { FilterValue } from './FilterPopover';
import TableToolbar, { AddColumnDialog, FieldType } from './TableToolbar';
import ExpandedRowCard from './ExpandedRowCard';
import ImageCropper from './ImageCropper';
import TypeSelectDropdown from './TypeSelectDropdown';

export type { FieldType };

export type ColumnSource = 'standard' | 'private' | 'community' | 'pending';

export interface ColumnConfig {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  required?: boolean;
  placeholder?: string;
  isCustom?: boolean;
  width?: number;
  sortable?: boolean;
  filterable?: boolean;
  persistOnClear?: boolean;
  creatable?: boolean;
  imageShape?: 'square' | 'circle';
  /** For type-select columns: aliases grouped by node type */
  typeAliases?: { name: string; color: string; nodeType: string }[];
  /** Callback to create a new alias from the type dropdown */
  onCreateAlias?: (alias: { name: string; color: string; nodeType: string }) => Promise<void>;
  /** Companion field key to set when selecting a type alias (e.g. 'alias') */
  aliasFieldKey?: string;
  // CRM extension
  source?: ColumnSource;
  columnId?: string;
  columnKey?: string;
  /** When present, called instead of onUpdate for saving this column's value */
  onCrmSave?: (nodeId: string, value: string) => Promise<void>;
}

export interface EditableDataTableProps<T> {
  columns: ColumnConfig[];
  data: T[];
  onAdd: (row: Partial<T>) => Promise<void>;
  onUpdate: (row: T, originalRow: T) => Promise<void>;
  onDelete: (row: T) => Promise<void>;
  getRowKey: (row: T) => string;
  createEmptyRow: () => Partial<T>;
  validateRow?: (row: Partial<T>) => string | null;
  onAddColumn?: (column: ColumnConfig) => void;
  /** When provided, clicking "Add Column" opens this callback instead of the built-in dialog */
  onAddColumnModal?: () => void;
  onRemoveColumn?: (columnKey: string) => void;
  customColumns?: ColumnConfig[];
  onNewRowChange?: (row: Partial<T>, columnKey: string) => Partial<T>;
  tableId?: string;
}


export default function EditableDataTable<T extends Record<string, unknown>>({
  columns,
  data,
  onAdd,
  onUpdate,
  onDelete,
  getRowKey,
  createEmptyRow,
  validateRow,
  onAddColumn,
  onAddColumnModal,
  onRemoveColumn,
  customColumns = [],
  // onNewRowChange is reserved for future use - transforming new row values
  onNewRowChange: _onNewRowChange,
  tableId = 'default',
}: EditableDataTableProps<T>) {
  // Silence unused variable warning - reserved for future row transformation feature
  void _onNewRowChange;
  // Merge columns
  const allColumns = useMemo(() => [...columns, ...customColumns], [columns, customColumns]);

  // State
  const [rows, setRows] = useState<T[]>(data);
  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    const stored = localStorage.getItem(`table_column_order_${tableId}`);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch { /* ignore */ }
    }
    return allColumns.map(c => c.key);
  });
  const [filters, setFilters] = useState<Record<string, FilterValue>>({});
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [globalSearch, setGlobalSearch] = useState('');
  const [editingCell, setEditingCell] = useState<{ rowKey: string; columnKey: string } | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newRow, setNewRow] = useState<Partial<T> | null>(null);
  const [showColumnDialog, setShowColumnDialog] = useState(false);
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState<string | null>(null);
  const [cropperState, setCropperState] = useState<{
    isOpen: boolean;
    file: File | null;
    rowKey: string;
    columnKey: string;
    nodeId: string;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null);
  const imageInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Sync rows with data prop
  useEffect(() => {
    setRows(data);
  }, [data]);

  // Sync column order when columns change
  useEffect(() => {
    const existingKeys = new Set(columnOrder);
    const newKeys = allColumns.map(c => c.key).filter(k => !existingKeys.has(k));
    if (newKeys.length > 0) {
      setColumnOrder([...columnOrder, ...newKeys]);
    }
  }, [allColumns, columnOrder]);

  // Persist column order
  useEffect(() => {
    localStorage.setItem(`table_column_order_${tableId}`, JSON.stringify(columnOrder));
  }, [columnOrder, tableId]);

  // Focus input when editing
  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current instanceof HTMLInputElement) {
        inputRef.current.select();
      }
    }
  }, [editingCell]);

  // Get ordered columns
  const orderedColumns = useMemo(() => {
    const columnMap = new Map(allColumns.map(c => [c.key, c]));
    return columnOrder
      .map(key => columnMap.get(key))
      .filter((c): c is ColumnConfig => c !== undefined);
  }, [allColumns, columnOrder]);

  // Apply filters and search
  const filteredRows = useMemo(() => {
    let result = [...rows];

    // Global search
    if (globalSearch.trim()) {
      const search = globalSearch.toLowerCase();
      result = result.filter(row =>
        orderedColumns.some(col => {
          const value = col.key.startsWith('metadata.')
            ? (row.metadata as Record<string, unknown>)?.[col.key.split('.')[1]]
            : row[col.key];
          if (value == null) return false;
          if (Array.isArray(value)) {
            return value.some(v => String(v).toLowerCase().includes(search));
          }
          return String(value).toLowerCase().includes(search);
        })
      );
    }

    // Column filters
    Object.entries(filters).forEach(([columnKey, filter]) => {
      result = result.filter(row => {
        const col = orderedColumns.find(c => c.key === columnKey);
        if (!col) return true;

        const value = col.key.startsWith('metadata.')
          ? (row.metadata as Record<string, unknown>)?.[col.key.split('.')[1]]
          : row[col.key];

        if (filter.type === 'text') {
          const strValue = String(value || '').toLowerCase();
          const filterValue = String(filter.value).toLowerCase();
          return filter.mode === 'equals'
            ? strValue === filterValue
            : strValue.includes(filterValue);
        }

        if (filter.type === 'select' || filter.type === 'tags') {
          const filterValues = filter.value as string[];
          if (Array.isArray(value)) {
            return filterValues.some(fv => value.includes(fv));
          }
          return filterValues.includes(String(value));
        }

        return true;
      });
    });

    // Sorting
    if (sortColumn) {
      const col = orderedColumns.find(c => c.key === sortColumn);
      if (col) {
        result.sort((a, b) => {
          const aVal = col.key.startsWith('metadata.')
            ? (a.metadata as Record<string, unknown>)?.[col.key.split('.')[1]]
            : a[col.key];
          const bVal = col.key.startsWith('metadata.')
            ? (b.metadata as Record<string, unknown>)?.[col.key.split('.')[1]]
            : b[col.key];

          const aStr = String(aVal || '');
          const bStr = String(bVal || '');
          const comparison = aStr.localeCompare(bStr);
          return sortDirection === 'asc' ? comparison : -comparison;
        });
      }
    }

    return result;
  }, [rows, globalSearch, filters, sortColumn, sortDirection, orderedColumns]);

  // Handlers
  const handleFilterChange = (columnKey: string, filter: FilterValue | null) => {
    setFilters(prev => {
      if (filter === null) {
        const { [columnKey]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [columnKey]: filter };
    });
  };

  const persistedFilterKeys = useMemo(
    () => new Set(allColumns.filter(c => c.persistOnClear).map(c => c.key)),
    [allColumns]
  );

  const handleClearFilters = () => {
    setFilters(prev => {
      const kept: typeof prev = {};
      for (const key of Object.keys(prev)) {
        if (persistedFilterKeys.has(key)) kept[key] = prev[key];
      }
      return kept;
    });
    setGlobalSearch('');
  };

  const handleSort = (columnKey: string) => {
    if (sortColumn === columnKey) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(columnKey);
      setSortDirection('asc');
    }
  };

  const toggleRowExpand = (rowKey: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(rowKey)) {
        next.delete(rowKey);
      } else {
        next.add(rowKey);
      }
      return next;
    });
  };

  // Drag and drop column reordering
  const handleDragStart = (columnKey: string) => {
    setDraggedColumn(columnKey);
  };

  const handleDragOver = (e: React.DragEvent, columnKey: string) => {
    e.preventDefault();
    if (draggedColumn && draggedColumn !== columnKey) {
      setDropTarget(columnKey);
    }
  };

  const handleDrop = (targetKey: string) => {
    if (draggedColumn && draggedColumn !== targetKey) {
      const newOrder = [...columnOrder];
      const draggedIndex = newOrder.indexOf(draggedColumn);
      const targetIndex = newOrder.indexOf(targetKey);

      if (draggedIndex !== -1 && targetIndex !== -1) {
        newOrder.splice(draggedIndex, 1);
        newOrder.splice(targetIndex, 0, draggedColumn);
        setColumnOrder(newOrder);
      }
    }
    setDraggedColumn(null);
    setDropTarget(null);
  };

  const handleDragEnd = () => {
    setDraggedColumn(null);
    setDropTarget(null);
  };

  // Type+alias selection handler
  const handleTypeAliasSelect = async (row: T, type: string, alias: string | null) => {
    const rowKey = getRowKey(row);
    setLoading(rowKey);
    setError(null);
    try {
      const updatedRow = { ...row, type, alias } as T;
      await onUpdate(updatedRow, row);
      setRows(prev => prev.map(r => getRowKey(r) === rowKey ? updatedRow : r));
      setEditingCell(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setLoading(null);
    }
  };

  // Cell editing
  const handleCellClick = (row: T, columnKey: string, columnType: FieldType, columnSource?: ColumnSource) => {
    if (columnType === 'readonly' || columnType === 'image' || columnType === 'tags') return;
    if (columnSource === 'pending') return; // can't edit pending columns

    const rowKey = getRowKey(row);
    setEditingCell({ rowKey, columnKey });
    const col = orderedColumns.find(c => c.key === columnKey);
    const value = col?.key.startsWith('metadata.')
      ? (row.metadata as Record<string, unknown>)?.[columnKey.split('.')[1]]
      : row[columnKey];
    setEditValue(String(value || ''));
    setError(null);
  };

  const handleCellSave = async () => {
    if (!editingCell) return;

    const { rowKey, columnKey } = editingCell;
    const row = rows.find(r => getRowKey(r) === rowKey);
    if (!row) return;

    const col = orderedColumns.find(c => c.key === columnKey);
    if (!col) return;

    const currentValue = col.key.startsWith('metadata.')
      ? (row.metadata as Record<string, unknown>)?.[columnKey.split('.')[1]]
      : row[columnKey];

    if (currentValue === editValue) {
      setEditingCell(null);
      return;
    }

    setLoading(rowKey);
    setError(null);

    try {
      // CRM columns have their own save path — no need to update the whole node
      if (col.onCrmSave) {
        const nodeId = row.id as string;
        await col.onCrmSave(nodeId, editValue);
        // Optimistic update of local row state
        setRows(prev => prev.map(r =>
          getRowKey(r) === rowKey ? { ...r, [columnKey]: editValue } : r
        ));
        setEditingCell(null);
        return;
      }

      let updatedRow: T;
      if (col.key.startsWith('metadata.')) {
        const metadataKey = col.key.split('.')[1];
        updatedRow = {
          ...row,
          metadata: { ...(row.metadata as Record<string, unknown> || {}), [metadataKey]: editValue },
        };
      } else {
        updatedRow = { ...row, [columnKey]: editValue };
      }

      if (validateRow) {
        const validationError = validateRow(updatedRow);
        if (validationError) {
          setError(validationError);
          return;
        }
      }

      if (col.required && !editValue) {
        setError(`${col.label} is required`);
        return;
      }

      await onUpdate(updatedRow, row);
      setRows(prev => prev.map(r => getRowKey(r) === rowKey ? updatedRow : r));
      setEditingCell(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setLoading(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCellSave();
    } else if (e.key === 'Escape') {
      setEditingCell(null);
      setError(null);
    }
  };

  // Tags update
  const handleTagsChange = async (row: T, columnKey: string, newTags: string[]) => {
    const rowKey = getRowKey(row);
    const col = orderedColumns.find(c => c.key === columnKey);
    if (!col) return;

    let updatedRow: T;
    if (col.key.startsWith('metadata.')) {
      const metadataKey = col.key.split('.')[1];
      updatedRow = {
        ...row,
        metadata: { ...(row.metadata as Record<string, unknown> || {}), [metadataKey]: newTags },
      };
    } else {
      updatedRow = { ...row, [columnKey]: newTags };
    }

    setLoading(rowKey);
    try {
      await onUpdate(updatedRow, row);
      setRows(prev => prev.map(r => getRowKey(r) === rowKey ? updatedRow : r));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setLoading(null);
    }
  };

  // Image upload - opens cropper first
  const handleImageSelect = (row: T, columnKey: string, file: File) => {
    const validationError = validateImageFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    const rowKey = getRowKey(row);
    setCropperState({
      isOpen: true,
      file,
      rowKey,
      columnKey,
      nodeId: row.id as string,
    });
    setError(null);
  };

  // Handle cropped image upload
  const handleCroppedImageUpload = async (blob: Blob) => {
    if (!cropperState) return;

    const { rowKey, columnKey, nodeId, file } = cropperState;
    const row = rows.find(r => getRowKey(r) === rowKey);
    if (!row) {
      setCropperState(null);
      return;
    }

    setImageUploading(rowKey);

    try {
      const publicUrl = await uploadCroppedNodeImage(nodeId, blob, file?.name);
      const updatedRow = { ...row, [columnKey]: publicUrl };
      await onUpdate(updatedRow, row);
      setRows(prev => prev.map(r => getRowKey(r) === rowKey ? updatedRow : r));
      setCropperState(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload image');
    } finally {
      setImageUploading(null);
    }
  };

  // Cancel cropper
  const handleCropperCancel = () => {
    setCropperState(null);
  };

  // Add row
  const handleAddRow = () => {
    const draft = createEmptyRow();
    setNewRow(draft);
    setError(null);
  };

  const handleSaveNewRow = async (row: Partial<T>) => {
    if (validateRow) {
      const validationError = validateRow(row);
      if (validationError) {
        throw new Error(validationError);
      }
    }

    await onAdd(row);
    setNewRow(null);
    setExpandedRows(new Set());
  };

  // Delete row
  const handleDeleteRow = async (row: T) => {
    if (!confirm('Are you sure you want to delete this row?')) return;

    const rowKey = getRowKey(row);
    setLoading(rowKey);
    setError(null);

    try {
      await onDelete(row);
      setRows(prev => prev.filter(r => getRowKey(r) !== rowKey));
      setExpandedRows(prev => {
        const next = new Set(prev);
        next.delete(rowKey);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setLoading(null);
    }
  };

  // Expanded row save
  const handleExpandedRowSave = async (updatedRow: T) => {
    const rowKey = getRowKey(updatedRow);
    const originalRow = rows.find(r => getRowKey(r) === rowKey);
    if (!originalRow) return;

    const nodeId = (updatedRow as Record<string, unknown>).id as string;

    // Save CRM columns separately, then save the rest of the node normally
    const crmSavePromises: Promise<void>[] = [];
    for (const col of orderedColumns) {
      if (col.onCrmSave && col.key in (updatedRow as Record<string, unknown>)) {
        const value = (updatedRow as Record<string, unknown>)[col.key] as string;
        const originalValue = (originalRow as Record<string, unknown>)[col.key] as string;
        if (value !== originalValue) {
          crmSavePromises.push(col.onCrmSave(nodeId, value ?? ''));
        }
      }
    }

    // Build a clean node row with CRM keys stripped out
    const cleanRow = { ...updatedRow } as Record<string, unknown>;
    for (const col of orderedColumns) {
      if (col.onCrmSave) {
        delete cleanRow[col.key];
      }
    }

    await Promise.all([
      onUpdate(cleanRow as T, originalRow),
      ...crmSavePromises,
    ]);

    setRows(prev => prev.map(r => getRowKey(r) === rowKey ? updatedRow : r));
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.delete(rowKey);
      return next;
    });
  };

  // Add custom column
  const handleAddCustomColumn = (name: string, type: FieldType) => {
    if (!onAddColumn) return;
    const columnKey = `metadata.${name.toLowerCase().replace(/\s+/g, '_')}`;
    const newColumn: ColumnConfig = {
      key: columnKey,
      label: name,
      type,
      isCustom: true,
      creatable: type === 'tags',
    };
    onAddColumn(newColumn);
  };

  // Render cell
  const renderCell = (row: T, col: ColumnConfig) => {
    const rowKey = getRowKey(row);
    const isEditing = editingCell?.rowKey === rowKey && editingCell?.columnKey === col.key;
    const isLoading = loading === rowKey;
    const isUploadingImage = imageUploading === rowKey;

    const value = col.key.startsWith('metadata.')
      ? (row.metadata as Record<string, unknown>)?.[col.key.split('.')[1]]
      : row[col.key];

    // Image cell
    if (col.type === 'image') {
      const imageUrl = value as string | undefined;
      return (
        <div className="flex items-center gap-2">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt=""
              className="w-10 h-10 rounded-lg object-cover border border-gray-200"
            />
          ) : (
            <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
              <Camera className="w-4 h-4 text-gray-400" />
            </div>
          )}
          <input
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp,image/tiff,image/bmp,image/heic,image/heif,image/svg+xml"
            className="hidden"
            ref={el => { imageInputRefs.current[rowKey] = el; }}
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) handleImageSelect(row, col.key, file);
              e.target.value = '';
            }}
            disabled={isUploadingImage}
          />
          <button
            type="button"
            onClick={() => imageInputRefs.current[rowKey]?.click()}
            disabled={isUploadingImage}
            className="p-1.5 rounded-lg border border-dashed border-gray-300 hover:border-blue-400 hover:bg-blue-50 transition-colors disabled:opacity-50"
          >
            {isUploadingImage ? (
              <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
            ) : (
              <Camera className="w-4 h-4 text-gray-400" />
            )}
          </button>
        </div>
      );
    }

    // Tags cell with combobox
    if (col.type === 'tags') {
      const tags = Array.isArray(value) ? value as string[] : [];
      return (
        <ComboboxMultiSelect
          value={tags}
          options={col.options || []}
          onChange={newTags => handleTagsChange(row, col.key, newTags)}
          placeholder={col.placeholder || 'Select...'}
          creatable={col.creatable !== false}
          disabled={isLoading}
        />
      );
    }

    // Editing state
    if (isEditing) {
      if (col.type === 'select' && col.typeAliases) {
        return (
          <TypeSelectDropdown
            row={row}
            col={col}
            currentType={String(row.type || '')}
            currentAlias={(row as Record<string, unknown>).alias as string | null}
            onSelect={(type, alias) => handleTypeAliasSelect(row, type, alias)}
            onClose={() => setEditingCell(null)}
            isLoading={isLoading}
          />
        );
      }

      if (col.type === 'select') {
        return (
          <select
            ref={inputRef as React.RefObject<HTMLSelectElement>}
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={handleCellSave}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            className="w-full px-3 py-2 text-sm border border-blue-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100"
          >
            <option value="">Select...</option>
            {col.options?.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        );
      }

      return (
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type={col.type === 'date' ? 'date' : 'text'}
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onBlur={handleCellSave}
          onKeyDown={handleKeyDown}
          placeholder={col.placeholder}
          disabled={isLoading}
          className="w-full px-3 py-2 text-sm border border-blue-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100"
        />
      );
    }

    // Display value — for type columns with aliases, show alias if set
    let displayValue = value;
    if (col.typeAliases && col.key === 'type') {
      const rowAlias = (row as Record<string, unknown>).alias as string | null;
      displayValue = rowAlias || value;
    }
    if (value == null || value === '') {
      displayValue = '';
    }

    const isPending = col.source === 'pending';
    const isClickable = col.type !== 'readonly' && !isPending;

    return (
      <div
        onClick={() => isClickable && handleCellClick(row, col.key, col.type, col.source)}
        className={`
          px-3 py-2 rounded-lg text-sm min-h-[42px] flex items-center
          ${isPending ? 'text-gray-300 bg-gray-50/50 cursor-not-allowed italic' : ''}
          ${!isPending && isClickable ? 'cursor-pointer hover:bg-gray-50' : ''}
          ${!isPending && !isClickable ? 'text-gray-500 bg-gray-50/50' : ''}
          ${isLoading ? 'opacity-50' : ''}
        `}
      >
        {displayValue ? (
          String(displayValue)
        ) : (
          <span className={isPending ? 'text-gray-300' : 'text-gray-400'}>
            {isPending ? 'Pending approval' : col.placeholder || (isClickable ? 'Click to edit' : '-')}
          </span>
        )}
      </div>
    );
  };

  const hasActiveFilters = Object.keys(filters).some(k => !persistedFilterKeys.has(k)) || globalSearch.trim().length > 0;

  return (
    <div className="w-full">
      {/* Error Banner */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700">{error}</p>
          <button
            onClick={() => setError(null)}
            className="mt-2 text-xs text-red-600 hover:text-red-800 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Toolbar */}
      <TableToolbar
        onAddRow={handleAddRow}
        onAddColumn={
          onAddColumnModal
            ? onAddColumnModal
            : onAddColumn
            ? () => setShowColumnDialog(true)
            : undefined
        }
        onClearFilters={handleClearFilters}
        hasActiveFilters={hasActiveFilters}
        rowCount={rows.length}
        filteredCount={filteredRows.length}
        searchValue={globalSearch}
        onSearchChange={setGlobalSearch}
        addRowDisabled={!!newRow}
      />

      {/* Add Column Dialog */}
      <AddColumnDialog
        isOpen={showColumnDialog}
        onClose={() => setShowColumnDialog(false)}
        onAdd={handleAddCustomColumn}
      />

      {/* Table */}
      <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-auto max-h-[calc(100vh-280px)] min-h-[400px]">
          <table className="w-full">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-50 border-b border-gray-200">
                {/* Expand column */}
                <th className="w-10 px-2 py-3 bg-gray-50"></th>

                {/* Data columns */}
                {orderedColumns.map(col => (
                  <th
                    key={col.key}
                    draggable
                    onDragStart={() => handleDragStart(col.key)}
                    onDragOver={e => handleDragOver(e, col.key)}
                    onDrop={() => handleDrop(col.key)}
                    onDragEnd={handleDragEnd}
                    className={`
                      px-4 py-3 text-left text-sm font-semibold text-gray-700
                      select-none transition-colors
                      ${dropTarget === col.key ? 'bg-blue-100' : 'bg-gray-50'}
                      ${draggedColumn === col.key ? 'opacity-50' : ''}
                    `}
                    style={{ minWidth: col.width || 120 }}
                  >
                    <div className="flex items-center gap-2">
                      <GripVertical className="w-4 h-4 text-gray-400 cursor-grab" />

                      {/* Source icon */}
                      {col.source === 'private' && (
                        <span title="Private column — only you can see this"><Lock className="w-3.5 h-3.5 text-blue-500 shrink-0" /></span>
                      )}
                      {col.source === 'community' && (
                        <span title="Community column"><Globe className="w-3.5 h-3.5 text-purple-500 shrink-0" /></span>
                      )}
                      {col.source === 'pending' && (
                        <span title="Pending admin approval"><Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" /></span>
                      )}

                      <span className={`flex-1 ${col.source === 'pending' ? 'text-gray-400' : ''}`}>
                        {col.label}
                        {col.required && <span className="text-red-500 ml-1">*</span>}
                      </span>

                      {/* Sort button — not on pending */}
                      {col.sortable !== false && col.type !== 'image' && col.source !== 'pending' && (
                        <button
                          type="button"
                          onClick={() => handleSort(col.key)}
                          className="p-1 rounded hover:bg-gray-200 transition-colors"
                        >
                          {sortColumn === col.key ? (
                            sortDirection === 'asc' ? (
                              <ArrowUp className="w-3.5 h-3.5 text-blue-600" />
                            ) : (
                              <ArrowDown className="w-3.5 h-3.5 text-blue-600" />
                            )
                          ) : (
                            <ArrowUpDown className="w-3.5 h-3.5 text-gray-400" />
                          )}
                        </button>
                      )}

                      {/* Filter button — not on pending */}
                      {col.filterable !== false && col.type !== 'image' && col.source !== 'pending' && (
                        <FilterPopover
                          columnKey={col.key}
                          columnLabel={col.label}
                          columnType={col.type}
                          options={col.options}
                          currentFilter={filters[col.key]}
                          onFilterChange={handleFilterChange}
                        />
                      )}

                      {/* Remove custom column */}
                      {col.isCustom && onRemoveColumn && col.source !== 'community' && (
                        <button
                          type="button"
                          onClick={() => onRemoveColumn(col.key)}
                          className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          title="Remove column"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </th>
                ))}

                {/* Actions column */}
                <th className="w-24 px-4 py-3 text-left text-sm font-semibold text-gray-700 bg-gray-50">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {/* New row (expanded form) */}
              {newRow && (
                <ExpandedRowCard
                  row={newRow as T}
                  columns={orderedColumns}
                  onSave={handleSaveNewRow}
                  onCancel={() => setNewRow(null)}
                  isNew
                />
              )}

              {/* Data rows */}
              {filteredRows.length === 0 && !newRow ? (
                <tr>
                  <td colSpan={orderedColumns.length + 2} className="px-6 py-12 text-center">
                    <div className="text-gray-500">
                      {rows.length === 0 ? (
                        <>No data yet. Click &quot;Add Row&quot; to get started.</>
                      ) : (
                        <>No results match your filters.</>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredRows.map((row, index) => {
                  const rowKey = getRowKey(row);
                  const isExpanded = expandedRows.has(rowKey);
                  const isLoading = loading === rowKey;

                  return (
                    <React.Fragment key={rowKey}>
                      {/* Main row */}
                      <tr className={`
                        ${isExpanded ? 'bg-blue-50/50' : index % 2 === 1 ? 'bg-gray-50/50' : ''}
                        ${isLoading ? 'opacity-50' : ''}
                        hover:bg-blue-50/30 transition-colors
                      `}>
                        {/* Expand button */}
                        <td className="px-2 py-3">
                          <button
                            type="button"
                            onClick={() => toggleRowExpand(rowKey)}
                            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-gray-500" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-gray-500" />
                            )}
                          </button>
                        </td>

                        {/* Data cells */}
                        {orderedColumns.map(col => (
                          <td key={col.key} className="px-4 py-3">
                            {renderCell(row, col)}
                          </td>
                        ))}

                        {/* Actions */}
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => handleDeleteRow(row)}
                            disabled={isLoading}
                            className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>

                      {/* Expanded row */}
                      {isExpanded && (
                        <ExpandedRowCard
                          row={row}
                          columns={orderedColumns}
                          onSave={handleExpandedRowSave}
                          onCancel={() => toggleRowExpand(rowKey)}
                          onImageUpload={async (r, colKey, file) => {
                            const publicUrl = await uploadNodeImage(r.id as string, file);
                            return publicUrl;
                          }}
                        />
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Image Cropper Modal */}
      {cropperState?.isOpen && cropperState.file && (() => {
        const cropRow = rows.find(r => getRowKey(r) === cropperState.rowKey);
        return (
          <ImageCropper
            imageFile={cropperState.file}
            onCrop={handleCroppedImageUpload}
            onCancel={handleCropperCancel}
            isUploading={imageUploading === cropperState.rowKey}
            previewName={(cropRow?.name as string) || undefined}
          />
        );
      })()}
    </div>
  );
}
