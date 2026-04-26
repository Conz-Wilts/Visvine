'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Filter, Check } from 'lucide-react';

export interface FilterValue {
  type: 'text' | 'select' | 'tags';
  value: string | string[];
  mode?: 'contains' | 'equals';
}

interface FilterPopoverProps {
  columnKey: string;
  columnLabel: string;
  columnType: 'text' | 'select' | 'tags' | 'readonly' | 'date' | 'image';
  options?: string[];
  currentFilter?: FilterValue;
  onFilterChange: (columnKey: string, filter: FilterValue | null) => void;
}

export default function FilterPopover({
  columnKey,
  columnLabel,
  columnType,
  options = [],
  currentFilter,
  onFilterChange,
}: FilterPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [textValue, setTextValue] = useState(
    typeof currentFilter?.value === 'string' ? currentFilter.value : ''
  );
  const [textMode, setTextMode] = useState<'contains' | 'equals'>(
    currentFilter?.mode || 'contains'
  );
  const [selectedOptions, setSelectedOptions] = useState<string[]>(
    Array.isArray(currentFilter?.value) ? currentFilter.value : []
  );
  const popoverRef = useRef<HTMLDivElement>(null);

  const hasFilter = currentFilter !== undefined && currentFilter !== null;

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleApplyTextFilter = () => {
    if (textValue.trim()) {
      onFilterChange(columnKey, {
        type: 'text',
        value: textValue.trim(),
        mode: textMode,
      });
    } else {
      onFilterChange(columnKey, null);
    }
    setIsOpen(false);
  };

  const handleToggleOption = (option: string) => {
    const newSelected = selectedOptions.includes(option)
      ? selectedOptions.filter((o) => o !== option)
      : [...selectedOptions, option];
    setSelectedOptions(newSelected);
  };

  const handleApplyOptionsFilter = () => {
    if (selectedOptions.length > 0) {
      onFilterChange(columnKey, {
        type: columnType === 'tags' ? 'tags' : 'select',
        value: selectedOptions,
      });
    } else {
      onFilterChange(columnKey, null);
    }
    setIsOpen(false);
  };

  const handleClearFilter = () => {
    setTextValue('');
    setSelectedOptions([]);
    onFilterChange(columnKey, null);
    setIsOpen(false);
  };

  // Determine filter type based on column type
  const isTextFilter = columnType === 'text' || columnType === 'date' || columnType === 'readonly';
  const isOptionsFilter = columnType === 'select' || columnType === 'tags';

  return (
    <div className="relative" ref={popoverRef}>
      {/* Filter button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`
          p-1 rounded transition-colors
          ${hasFilter
            ? 'text-blue-600 bg-blue-50 hover:bg-blue-100'
            : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
          }
        `}
        title={`Filter by ${columnLabel}`}
      >
        <Filter className="w-3.5 h-3.5" />
      </button>

      {/* Popover */}
      {isOpen && (
        <div className="absolute z-50 top-full left-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg">
          <div className="p-3 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">
                Filter: {columnLabel}
              </span>
              {hasFilter && (
                <button
                  type="button"
                  onClick={handleClearFilter}
                  className="text-xs text-red-600 hover:text-red-700"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="p-3">
            {/* Text filter */}
            {isTextFilter && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setTextMode('contains')}
                    className={`
                      flex-1 px-2 py-1 text-xs rounded border transition-colors
                      ${textMode === 'contains'
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-200 hover:border-gray-300'
                      }
                    `}
                  >
                    Contains
                  </button>
                  <button
                    type="button"
                    onClick={() => setTextMode('equals')}
                    className={`
                      flex-1 px-2 py-1 text-xs rounded border transition-colors
                      ${textMode === 'equals'
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-200 hover:border-gray-300'
                      }
                    `}
                  >
                    Equals
                  </button>
                </div>
                <input
                  type="text"
                  value={textValue}
                  onChange={(e) => setTextValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleApplyTextFilter()}
                  placeholder="Filter value..."
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleApplyTextFilter}
                  className="w-full px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Apply Filter
                </button>
              </div>
            )}

            {/* Options filter (select/tags) */}
            {isOptionsFilter && (
              <div className="space-y-2">
                {options.length > 0 ? (
                  <>
                    <div className="max-h-48 overflow-auto space-y-1">
                      {options.map((option) => {
                        const isSelected = selectedOptions.includes(option);
                        return (
                          <button
                            key={option}
                            type="button"
                            onClick={() => handleToggleOption(option)}
                            className={`
                              w-full px-3 py-2 text-sm text-left rounded flex items-center justify-between
                              transition-colors
                              ${isSelected ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'}
                            `}
                          >
                            <span>{option}</span>
                            {isSelected && <Check className="w-4 h-4" />}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={handleApplyOptionsFilter}
                      className="w-full px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      Apply Filter
                    </button>
                  </>
                ) : (
                  <div className="text-sm text-gray-500 py-2">No options available</div>
                )}
              </div>
            )}

            {/* Image columns - no filter */}
            {columnType === 'image' && (
              <div className="text-sm text-gray-500 py-2">
                Image columns cannot be filtered
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
