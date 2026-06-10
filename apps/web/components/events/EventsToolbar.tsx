'use client';

/**
 * Toolbar for Events page — filters row below header
 * Grey dropdown-style selectors matching Directory's FilterDropdown pattern
 */

import { useEffect, useRef, useState } from 'react';
import { X, ChevronDown, Check } from 'lucide-react';

interface EventsToolbarProps {
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
        className="flex h-12 items-center gap-2 rounded-2xl border px-4 text-sm font-semibold shadow-sm transition-colors"
        style={
          isFiltered
            ? { borderColor: 'var(--color-brand-green)', backgroundColor: 'var(--color-brand-light-bg)', color: 'var(--color-brand-dark-green)' }
            : { borderColor: 'var(--border-default, #e5e7eb)', backgroundColor: 'var(--surface-1, #fff)', color: 'var(--text-secondary, #374151)' }
        }
      >
        <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} style={{ opacity: 0.5 }} />
        <span style={{ opacity: 0.65 }}>{label}:</span>
        <span>{activeLabel}</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 z-50 min-w-[160px] rounded-2xl border border-border-subtle bg-surface-1 shadow-xl py-1.5 overflow-hidden">
          {options.map(opt => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className="flex w-full items-center justify-between px-4 py-2.5 text-sm transition-colors hover:bg-surface-2"
            >
              <span className={value === opt.value ? 'font-medium text-text-primary' : 'text-text-secondary'}>
                {opt.label}
              </span>
              {value === opt.value && <Check className="h-4 w-4 text-brand-green" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function EventsToolbar({
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
    </div>
  );
}
