'use client';

import { useMemo } from 'react';
import { CountryFlagIcon, EmptyState } from '@/components/ui';
import { FilterDropdown } from '@/features/directory/components/FilterDropdown';
import { spaceMark } from '@/lib/spaces/subspaces';
import { countryOptions, filterSpaces, sectorOptions, spaceCountryCode } from '@/lib/discover/filters';
import type { Space } from '@/lib/types';
import FilterStrip from './FilterStrip';
import SpaceCard from './SpaceCard';

/** How many sectors the strip shows before it is a dropdown's job. */
const SECTOR_STRIP_MAX = 8;

/**
 * Every open space, as a grid. Narrowed by where (a country dropdown, flags
 * and all) and by sector (the tags the spaces declare, as a strip of words
 * with counts — "browse by category", without the tiles).
 */
export default function SpacesView({
  spaces,
  search,
  countries,
  onCountries,
  sectors,
  onSectors,
  isJoined,
  onJoin,
}: {
  spaces: Space[];
  search: string;
  countries: Set<string>;
  onCountries: (next: Set<string>) => void;
  sectors: Set<string>;
  onSectors: (next: Set<string>) => void;
  isJoined: (id: string) => boolean;
  onJoin: (space: Space) => void;
}) {
  const countryOpts = useMemo(() => countryOptions(spaces.map(spaceCountryCode)), [spaces]);
  const sectorOpts = useMemo(() => sectorOptions(spaces), [spaces]);
  const shown = useMemo(() => filterSpaces(spaces, { search, countries, sectors }), [spaces, search, countries, sectors]);
  const nameOf = (id: string | null | undefined) => (id ? (spaces.find((s) => s.id === id)?.name ?? null) : null);

  const stripSectors = sectorOpts.slice(0, SECTOR_STRIP_MAX);
  const hasFilter = countries.size > 0 || sectors.size > 0 || search.trim() !== '';

  return (
    <div>
      {(countryOpts.length > 0 || sectorOpts.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-1">
          {countryOpts.length > 0 && (
            <FilterDropdown
              label="Where"
              options={countryOpts.map((o) => ({ value: o.value, label: o.label, count: o.count }))}
              selected={countries}
              onChange={onCountries}
            />
          )}
          {countryOpts.length > 0 && sectorOpts.length > 0 && <div className="hidden h-6 w-px shrink-0 bg-border-subtle sm:block" />}
          {stripSectors.length > 0 && (
            <FilterStrip
              label="Sector"
              showLabel
              options={stripSectors.map((o) => ({ value: o.value, label: o.label, count: o.count }))}
              value={sectors}
              onChange={(next) => onSectors(next as Set<string>)}
            />
          )}
          {sectorOpts.length > SECTOR_STRIP_MAX && (
            <FilterDropdown
              label="More"
              options={sectorOpts.slice(SECTOR_STRIP_MAX).map((o) => ({ value: o.value, label: o.label, count: o.count }))}
              selected={sectors}
              onChange={onSectors}
            />
          )}
        </div>
      )}

      {countries.size > 0 && (
        <p className="flex items-center gap-2 pt-3 text-[13px] text-text-muted">
          {[...countries].map((c) => <CountryFlagIcon key={c} code={c} className="h-[11px] w-[15px]" />)}
          <span>{shown.length} {shown.length === 1 ? 'space' : 'spaces'}</span>
        </p>
      )}

      {shown.length === 0 ? (
        <EmptyState
          title={hasFilter ? 'No spaces match' : 'No open spaces yet'}
          description={hasFilter ? 'Try a wider search, or clear a filter.' : 'Spaces that choose to be public appear here.'}
        />
      ) : (
        <div className="grid gap-x-6 gap-y-8 pt-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
          {shown.map((space) => (
            <SpaceCard
              key={space.id}
              space={space}
              mark={spaceMark(space, spaces)}
              parentName={nameOf(space.parentId)}
              joined={isJoined(space.id)}
              onJoin={onJoin}
            />
          ))}
        </div>
      )}
    </div>
  );
}
