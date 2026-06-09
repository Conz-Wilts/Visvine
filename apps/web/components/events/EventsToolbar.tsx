'use client';

/**
 * Toolbar for Events page — filters row below header
 * Grey dropdown-style selectors matching Directory's FilterDropdown pattern
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Search, X, ChevronDown, Check } from 'lucide-react';

interface EventsToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  currentFilter: 'all' | 'upcoming' | 'past';
  onFilterChange: (filter: 'all' | 'upcoming' | 'past') => void;
  locationFilter?: 'all' | 'in-person' | 'virtual';
  onLocationFilterChange?: (filter: 'all' | 'in-person' | 'virtual') => void;
}

const TIME_OPTIONS: { value: 'all' | 'upcoming' | 'past'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
];

const LOCATION_OPTIONS: { value: 'all' | 'in-person' | 'virtual'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'in-person', label: 'In-Person' },
  { value: 'virtual', label: 'Virtual' },
];

function MiniDropdown<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const activeLabel = options.find(o => o.value === value)?.label ?? label;
  const isFiltered = value !== 'all';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex h-9 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold transition-colors border ${
          isFiltered
            ? 'border-brand-green/40 bg-brand-green/10 text-brand-green'
            : 'border-border-default bg-surface-1 text-text-muted hover:text-text-secondary hover:bg-surface-2'
        }`}
      >
        {label}{isFiltered ? `: ${activeLabel}` : ''}
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 min-w-[140px] rounded-xl border border-border-default bg-surface-1 shadow-lg py-1">
          {options.map(opt => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors ${
                value === opt.value
                  ? 'text-brand-green font-semibold bg-brand-green/5'
                  : 'text-text-secondary hover:bg-surface-2'
              }`}
            >
              {value === opt.value && <Check className="h-3 w-3" />}
              <span className={value !== opt.value ? 'pl-5' : ''}>{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function EventsToolbar({
  searchQuery,
  onSearchChange,
  currentFilter,
  onFilterChange,
  locationFilter = 'all',
  onLocationFilterChange,
}: EventsToolbarProps) {
  const hasFilters = currentFilter !== 'all' || locationFilter !== 'all';

  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
      <MiniDropdown label="Time" value={currentFilter} options={TIME_OPTIONS} onChange={onFilterChange} />
      {onLocationFilterChange && (
        <MiniDropdown label="Type" value={locationFilter} options={LOCATION_OPTIONS} onChange={onLocationFilterChange} />
      )}

      {hasFilters && (
        <button
          onClick={() => {
            onFilterChange('all');
            onLocationFilterChange?.('all');
          }}
          className="flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-text-muted hover:text-text-secondary hover:bg-surface-3 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
          Clear
        </button>
      )}

      {/* Spacer — only separates on sm+; on mobile the search wraps to its own row */}
      <div className="hidden sm:block sm:flex-1" />

      {/* Search — full-width on its own row on mobile, inline (max-w-xs) on sm+ */}
      <div className="relative order-last w-full min-w-0 sm:order-none sm:w-auto sm:max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => onSearchChange(e.target.value)}
          placeholder="Search events..."
          className="w-full pl-9 pr-8 py-2 text-sm rounded-full border border-border-default bg-surface-1 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-green/20 focus:border-brand-green transition-all"
        />
        {searchQuery && (
          <button
            onClick={() => onSearchChange('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-text-primary"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Add button */}
      <Link
        href="/events/new"
        className="flex h-9 items-center gap-2 rounded-full px-4 bg-brand-green font-semibold hover:opacity-90 transition-all shadow-sm text-white text-sm ml-auto sm:ml-0"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Add
      </Link>
    </div>
  );
}
