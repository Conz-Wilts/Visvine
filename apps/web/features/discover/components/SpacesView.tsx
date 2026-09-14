'use client';

import { useMemo } from 'react';
import { Chip, EmptyState } from '@/components/ui';
import { spaceMark } from '@/lib/spaces/subspaces';
import { tagPalette } from '@/lib/tagColors';
import { filterSpaces, sectorOptions } from '@/lib/discover/filters';
import type { Space } from '@/lib/types';
import type { ViewerDoor } from '@/features/spaces/lib/viewerDoor';
import SpaceTile from './SpaceTile';

const SPACE_GRID_STYLE: React.CSSProperties = {
  display: 'grid',
  gap: '20px',
  gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
};

/**
 * Every open space as a grid of tiles, under a strip of the sectors they
 * declare — browse by category, as a row of coloured chips with counts.
 * Search and the Where filter arrive from the toolbar.
 */
export default function SpacesView({
  spaces,
  search,
  countries,
  sectors,
  onSectors,
  isJoined,
  isAsked,
  doorFor,
  onJoin,
}: {
  spaces: Space[];
  search: string;
  countries: Set<string>;
  sectors: Set<string>;
  onSectors: (next: Set<string>) => void;
  isJoined: (id: string) => boolean;
  isAsked?: (id: string) => boolean;
  doorFor?: (space: Space) => ViewerDoor;
  onJoin: (space: Space) => void;
}) {
  const sectorOpts = useMemo(() => sectorOptions(spaces), [spaces]);
  const shown = useMemo(() => filterSpaces(spaces, { search, countries, sectors }), [spaces, search, countries, sectors]);
  const nameOf = (id: string | null | undefined) => (id ? (spaces.find((s) => s.id === id)?.name ?? null) : null);
  const hasFilter = countries.size > 0 || sectors.size > 0 || search.trim() !== '';

  const toggleSector = (key: string) => {
    const next = new Set(sectors);
    if (next.has(key)) next.delete(key); else next.add(key);
    onSectors(next);
  };

  return (
    <div className="flex flex-col gap-6">
      {sectorOpts.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[13px] font-semibold text-text-primary">Browse by sector</span>
          {sectorOpts.map((o) => {
            const on = sectors.has(o.value);
            return (
              <Chip
                key={o.value}
                size="lg"
                tone={on ? 'solid' : 'muted'}
                color={tagPalette(o.label).base}
                onClick={() => toggleSector(o.value)}
              >
                {o.label}
                <span className={`tabular-nums ${on ? 'text-white/80' : 'text-text-muted'}`}>{o.count}</span>
              </Chip>
            );
          })}
        </div>
      )}

      {shown.length === 0 ? (
        <EmptyState
          title={hasFilter ? 'No spaces match' : 'No open spaces yet'}
          description={hasFilter ? 'Try a wider search, or clear a filter.' : 'Spaces that choose to be public appear here.'}
        />
      ) : (
        <div style={SPACE_GRID_STYLE} className="w-full">
          {shown.map((space) => (
            <SpaceTile
              key={space.id}
              space={space}
              mark={spaceMark(space, spaces)}
              parentName={nameOf(space.parentId)}
              joined={isJoined(space.id)}
              door={doorFor ? doorFor(space) : 'active'}
              asked={isAsked ? isAsked(space.id) : false}
              onJoin={onJoin}
            />
          ))}
        </div>
      )}
    </div>
  );
}
