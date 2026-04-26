'use client';

import React, { useState, useRef, useEffect } from 'react';
import { X, ChevronDown, Plus, Check } from 'lucide-react';

interface ComboboxMultiSelectProps {
  value: string[];
  options: string[];
  onChange: (value: string[]) => void;
  onCreateOption?: (option: string) => void;
  placeholder?: string;
  creatable?: boolean;
  disabled?: boolean;
}

// Generate consistent color for a tag based on its value
function getTagColor(tag: string): { bg: string; text: string; border: string } {
  const colors = [
    { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200' },
    { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-200' },
    { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-200' },
    { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200' },
    { bg: 'bg-rose-100', text: 'text-rose-700', border: 'border-rose-200' },
    { bg: 'bg-cyan-100', text: 'text-cyan-700', border: 'border-cyan-200' },
    { bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-200' },
    { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-200' },
  ];

  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

export default function ComboboxMultiSelect({
  value,
  options,
  onChange,
  onCreateOption,
  placeholder = 'Select or type...',
  creatable = true,
  disabled = false,
}: ComboboxMultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter options based on search
  const filteredOptions = options.filter(
    (opt) => opt.toLowerCase().includes(search.toLowerCase()) && !value.includes(opt)
  );

  // Check if search value can be created (not in options, not already selected)
  const canCreate = creatable &&
    search.trim() &&
    !options.some(opt => opt.toLowerCase() === search.toLowerCase()) &&
    !value.some(v => v.toLowerCase() === search.toLowerCase());

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (option: string) => {
    if (!value.includes(option)) {
      onChange([...value, option]);
    }
    setSearch('');
    inputRef.current?.focus();
  };

  const handleRemove = (option: string) => {
    onChange(value.filter((v) => v !== option));
  };

  const handleCreate = () => {
    const newOption = search.trim();
    if (newOption && canCreate) {
      if (onCreateOption) {
        onCreateOption(newOption);
      }
      onChange([...value, newOption]);
      setSearch('');
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (canCreate) {
        handleCreate();
      } else if (filteredOptions.length > 0) {
        handleSelect(filteredOptions[0]);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      setSearch('');
    } else if (e.key === 'Backspace' && !search && value.length > 0) {
      handleRemove(value[value.length - 1]);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Input area with chips */}
      <div
        onClick={() => {
          if (!disabled) {
            setIsOpen(true);
            inputRef.current?.focus();
          }
        }}
        className={`
          min-h-[42px] px-3 py-2 border rounded-lg
          flex flex-wrap items-center gap-1.5
          transition-colors cursor-text
          ${disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white hover:border-gray-400'}
          ${isOpen ? 'border-blue-500 ring-2 ring-blue-100' : 'border-gray-300'}
        `}
      >
        {/* Selected chips */}
        {value.map((item) => {
          const color = getTagColor(item);
          return (
            <span
              key={item}
              className={`
                inline-flex items-center gap-1 px-2 py-0.5 rounded-md
                text-xs font-medium border
                ${color.bg} ${color.text} ${color.border}
              `}
            >
              {item}
              {!disabled && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemove(item);
                  }}
                  className="hover:opacity-70 transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
          );
        })}

        {/* Search input */}
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onFocus={() => !disabled && setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={value.length === 0 ? placeholder : ''}
          disabled={disabled}
          className="flex-1 min-w-[100px] outline-none text-sm bg-transparent disabled:cursor-not-allowed"
        />

        {/* Dropdown arrow */}
        <ChevronDown
          className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </div>

      {/* Dropdown */}
      {isOpen && !disabled && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto">
          {/* Create option */}
          {canCreate && (
            <button
              type="button"
              onClick={handleCreate}
              className="w-full px-3 py-2 text-left text-sm hover:bg-blue-50 flex items-center gap-2 text-blue-600 border-b border-gray-100"
            >
              <Plus className="w-4 h-4" />
              Create &quot;{search.trim()}&quot;
            </button>
          )}

          {/* Existing options */}
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option) => {
              const isSelected = value.includes(option);
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => handleSelect(option)}
                  className={`
                    w-full px-3 py-2 text-left text-sm flex items-center justify-between
                    hover:bg-gray-50 transition-colors
                    ${isSelected ? 'bg-blue-50' : ''}
                  `}
                >
                  <span>{option}</span>
                  {isSelected && <Check className="w-4 h-4 text-blue-600" />}
                </button>
              );
            })
          ) : (
            !canCreate && (
              <div className="px-3 py-2 text-sm text-gray-500">
                {search ? 'No matches found' : 'No options available'}
              </div>
            )
          )}

          {/* Already selected options at bottom */}
          {value.length > 0 && filteredOptions.length > 0 && (
            <div className="border-t border-gray-100 pt-1 mt-1">
              <div className="px-3 py-1 text-xs text-gray-400 font-medium">Selected</div>
              {value.map((option) => {
                const color = getTagColor(option);
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => handleRemove(option)}
                    className="w-full px-3 py-1.5 text-left text-sm flex items-center justify-between hover:bg-gray-50"
                  >
                    <span className={`px-2 py-0.5 rounded text-xs ${color.bg} ${color.text}`}>
                      {option}
                    </span>
                    <X className="w-3 h-3 text-gray-400" />
                  </button>
                );
              })}
            </div>
          )}

          {/* Always-visible create hint when creatable and not already showing a create option */}
          {creatable && !canCreate && (
            <div className="border-t border-gray-100 px-3 py-2 flex items-center gap-2 text-xs text-gray-400">
              <Plus className="w-3 h-3 flex-shrink-0" />
              Type to create a new tag
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export { getTagColor };
