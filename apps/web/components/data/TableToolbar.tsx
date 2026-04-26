'use client';

import React, { useState } from 'react';
import { Plus, Columns, X, Search } from 'lucide-react';

export type FieldType = 'text' | 'select' | 'tags' | 'readonly' | 'date' | 'image';

interface TableToolbarProps {
  onAddRow: () => void;
  onAddColumn?: () => void;
  onClearFilters?: () => void;
  hasActiveFilters: boolean;
  rowCount: number;
  filteredCount?: number;
  searchValue: string;
  onSearchChange: (value: string) => void;
  addRowDisabled?: boolean;
  addRowLabel?: string;
}

export default function TableToolbar({
  onAddRow,
  onAddColumn,
  onClearFilters,
  hasActiveFilters,
  rowCount,
  filteredCount,
  searchValue,
  onSearchChange,
  addRowDisabled = false,
  addRowLabel = 'Add Row',
}: TableToolbarProps) {
  return (
    <div className="flex items-center justify-between gap-4 mb-4">
      {/* Left side - Actions */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onAddRow}
          disabled={addRowDisabled}
          className="
            inline-flex items-center gap-2 px-4 py-2
            bg-blue-600 text-white text-sm font-medium rounded-lg
            hover:bg-blue-700 transition-colors
            disabled:bg-gray-300 disabled:cursor-not-allowed
          "
        >
          <Plus className="w-4 h-4" />
          {addRowLabel}
        </button>

        {onAddColumn && (
          <button
            type="button"
            onClick={onAddColumn}
            className="
              inline-flex items-center gap-2 px-4 py-2
              bg-white text-gray-700 text-sm font-medium rounded-lg
              border border-gray-300 hover:bg-gray-50 transition-colors
            "
          >
            <Columns className="w-4 h-4" />
            Add Column
          </button>
        )}

        {hasActiveFilters && onClearFilters && (
          <button
            type="button"
            onClick={onClearFilters}
            className="
              inline-flex items-center gap-1.5 px-3 py-2
              text-red-600 text-sm font-medium rounded-lg
              hover:bg-red-50 transition-colors
            "
          >
            <X className="w-4 h-4" />
            Clear Filters
          </button>
        )}
      </div>

      {/* Right side - Search and count */}
      <div className="flex items-center gap-4">
        {/* Global search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search all columns..."
            className="
              w-64 pl-9 pr-4 py-2 text-sm
              border border-gray-300 rounded-lg
              focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500
              placeholder:text-gray-400
            "
          />
          {searchValue && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Row count */}
        <div className="text-sm text-gray-500">
          {filteredCount !== undefined && filteredCount !== rowCount ? (
            <span>
              Showing <span className="font-medium text-gray-700">{filteredCount}</span> of{' '}
              <span className="font-medium text-gray-700">{rowCount}</span>
            </span>
          ) : (
            <span>
              <span className="font-medium text-gray-700">{rowCount}</span>{' '}
              {rowCount === 1 ? 'row' : 'rows'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// Add Column Dialog Component
interface AddColumnDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (name: string, type: FieldType) => void;
}

export function AddColumnDialog({ isOpen, onClose, onAdd }: AddColumnDialogProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<FieldType>('text');

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (name.trim()) {
      onAdd(name.trim(), type);
      setName('');
      setType('text');
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Dialog */}
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Add Custom Column</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Column Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Phone Number"
              className="
                w-full px-4 py-2 text-sm
                border border-gray-300 rounded-lg
                focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500
              "
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Column Type
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as FieldType)}
              className="
                w-full px-4 py-2 text-sm
                border border-gray-300 rounded-lg
                focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500
              "
            >
              <option value="text">Text</option>
              <option value="tags">Tags (Multi-select)</option>
              <option value="date">Date</option>
              <option value="select">Select (Single)</option>
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="
              px-4 py-2 text-sm bg-blue-600 text-white rounded-lg
              hover:bg-blue-700 transition-colors
              disabled:bg-gray-300 disabled:cursor-not-allowed
            "
          >
            Add Column
          </button>
        </div>
      </div>
    </div>
  );
}
