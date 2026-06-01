'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { aliasesForType } from '@/lib/types';
import type { ColumnConfig } from './EditableDataTable';

interface TypeSelectDropdownProps<T> {
  row: T;
  col: ColumnConfig;
  currentType: string;
  currentAlias: string | null;
  onSelect: (type: string, alias: string | null) => void;
  onClose: () => void;
  isLoading: boolean;
}

export default function TypeSelectDropdown<T extends Record<string, unknown>>({
  row: _row,
  col,
  currentType,
  currentAlias,
  onSelect,
  onClose,
  isLoading,
}: TypeSelectDropdownProps<T>) {
  void _row;
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [creatingForType, setCreatingForType] = useState<string | null>(null);
  const [newAliasName, setNewAliasName] = useState('');
  const newAliasInputRef = useRef<HTMLInputElement>(null);

  const aliases = col.typeAliases || [];
  const types = col.options || [];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  useEffect(() => {
    if (creatingForType && newAliasInputRef.current) {
      newAliasInputRef.current.focus();
    }
  }, [creatingForType]);

  const handleCreateAlias = async () => {
    if (!newAliasName.trim() || !creatingForType || !col.onCreateAlias) return;
    await col.onCreateAlias({ name: newAliasName.trim(), color: '#6b7280', nodeType: creatingForType });
    setNewAliasName('');
    setCreatingForType(null);
  };

  return (
    <div ref={dropdownRef} className="relative">
      <div className="absolute z-50 top-0 left-0 w-64 bg-white border border-gray-200 rounded-xl shadow-lg max-h-72 overflow-y-auto py-1">
        {types.map(type => {
          const typeAliases = aliasesForType(aliases, type);
          const isSelected = currentType === type && !currentAlias;

          return (
            <div key={type}>
              {/* Base type option */}
              <button
                type="button"
                disabled={isLoading}
                onClick={() => onSelect(type, null)}
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-gray-50 transition-colors ${isSelected ? 'bg-blue-50 font-semibold' : ''}`}
              >
                <span className="font-medium">{type}</span>
              </button>

              {/* Aliases under this type */}
              {typeAliases.map(alias => {
                const isAliasSelected = currentType === type && currentAlias === alias.name;
                return (
                  <button
                    key={alias.name}
                    type="button"
                    disabled={isLoading}
                    onClick={() => onSelect(type, alias.name)}
                    className={`w-full text-left pl-7 pr-3 py-1.5 text-sm flex items-center gap-2 hover:bg-gray-50 transition-colors ${isAliasSelected ? 'bg-blue-50 font-semibold' : ''}`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: alias.color }}
                    />
                    <span>{alias.name}</span>
                  </button>
                );
              })}

              {/* Create alias inline form or button */}
              {col.onCreateAlias && (
                creatingForType === type ? (
                  <div className="pl-7 pr-3 py-1.5 flex items-center gap-1">
                    <input
                      ref={newAliasInputRef}
                      type="text"
                      value={newAliasName}
                      onChange={e => setNewAliasName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); handleCreateAlias(); }
                        if (e.key === 'Escape') { setCreatingForType(null); setNewAliasName(''); }
                      }}
                      placeholder="Alias name"
                      className="flex-1 min-w-0 px-2 py-1 text-xs border border-gray-300 rounded-md focus:outline-none focus:border-blue-400"
                    />
                    <button
                      type="button"
                      onClick={handleCreateAlias}
                      disabled={!newAliasName.trim()}
                      className="p-1 text-blue-600 hover:bg-blue-50 rounded disabled:opacity-30"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => { setCreatingForType(null); setNewAliasName(''); }}
                      className="p-1 text-gray-400 hover:bg-gray-100 rounded"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setCreatingForType(type)}
                    className="w-full text-left pl-7 pr-3 py-1.5 text-xs text-gray-400 hover:text-blue-600 hover:bg-gray-50 flex items-center gap-1 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    Create alias
                  </button>
                )
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
