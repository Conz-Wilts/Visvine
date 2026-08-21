'use client';

/**
 * The Events page's filters: Time and Type as text dropdowns, plus Clear once
 * either is off its default. Sits inline on the toolbar row beside the search.
 */

import { XIcon } from '@/features/shared/icons';
import Dropdown from '@/components/ui/Dropdown';

interface EventsToolbarProps {
  currentFilter: 'upcoming' | 'past';
  onFilterChange: (filter: 'upcoming' | 'past') => void;
  locationFilter?: 'all' | 'in-person' | 'virtual';
  onLocationFilterChange?: (filter: 'all' | 'in-person' | 'virtual') => void;
}

const TIME_OPTIONS: { value: 'upcoming' | 'past'; label: string }[] = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
];

const LOCATION_OPTIONS: { value: 'all' | 'in-person' | 'virtual'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'in-person', label: 'In-Person' },
  { value: 'virtual', label: 'Virtual' },
];

export default function EventsToolbar({
  currentFilter,
  onFilterChange,
  locationFilter = 'all',
  onLocationFilterChange,
}: EventsToolbarProps) {
  const hasFilters = currentFilter !== 'upcoming' || locationFilter !== 'all';

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Dropdown
        label="Time"
        value={currentFilter}
        options={TIME_OPTIONS}
        onChange={onFilterChange}
        active={currentFilter !== 'upcoming'}
      />
      {onLocationFilterChange && (
        <Dropdown
          label="Type"
          value={locationFilter}
          options={LOCATION_OPTIONS}
          onChange={onLocationFilterChange}
          active={locationFilter !== 'all'}
        />
      )}

      {hasFilters && (
        <button
          onClick={() => {
            onFilterChange('upcoming');
            onLocationFilterChange?.('all');
          }}
          className="flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-text-primary hover:bg-surface-3 transition-colors"
        >
          <XIcon className="h-3.5 w-3.5" />
          Clear
        </button>
      )}
    </div>
  );
}
