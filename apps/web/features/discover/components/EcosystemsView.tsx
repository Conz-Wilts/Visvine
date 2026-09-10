'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import SpaceAvatar from '@/features/spaces/components/SpaceAvatar';
import { CountryFlagIcon, EmptyState } from '@/components/ui';
import { ecosystemsOf, filterSpaces, spaceCountryCode } from '@/lib/discover/filters';
import type { Space } from '@/lib/types';
import JoinWord from './JoinWord';
import SpaceTile, { formatMemberCount } from './SpaceTile';

const BRANCH_GRID: React.CSSProperties = {
  display: 'grid',
  gap: '16px',
  gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
};

/**
 * A space with sub-spaces is an ecosystem: a network, an accelerator, a fund
 * and its portfolio. Each is a section — the parent as its head (mark, name,
 * facts, Join), and the sub-spaces as a row of tiles under it, each wearing
 * the parent's mark the way the rail draws a branch.
 */
export default function EcosystemsView({
  spaces,
  search,
  countries,
  isJoined,
  onJoin,
}: {
  spaces: Space[];
  search: string;
  countries: Set<string>;
  isJoined: (id: string) => boolean;
  onJoin: (space: Space) => void;
}) {
  const ecosystems = useMemo(() => {
    const all = ecosystemsOf(spaces).filter((eco) => filterSpaces([eco.parent], { countries }).length > 0);
    const q = search.trim();
    if (!q) return all;
    // A search keeps an ecosystem when the head or any branch matches, and
    // trims the branch to the matching rooms.
    return all.flatMap((eco) => {
      if (filterSpaces([eco.parent], { search: q }).length > 0) return [eco];
      const children = filterSpaces(eco.children, { search: q });
      return children.length > 0 ? [{ ...eco, children }] : [];
    });
  }, [spaces, search, countries]);

  if (ecosystems.length === 0) {
    return (
      <EmptyState
        title={search.trim() || countries.size > 0 ? 'No ecosystems match' : 'No ecosystems yet'}
        description={search.trim() || countries.size > 0 ? 'Try a wider search, or clear a filter.' : 'A space with open sub-spaces shows up here as one tree.'}
      />
    );
  }

  return (
    <div className="flex flex-col gap-10">
      {ecosystems.map(({ parent, children }) => {
        const country = spaceCountryCode(parent);
        const href = `/communities/${encodeURIComponent(parent.id)}`;
        return (
          <section key={parent.id} aria-label={parent.name}>
            <div className="flex items-start gap-4">
              <Link href={href} className="shrink-0">
                <SpaceAvatar name={parent.name} imageUrl={parent.imageUrl} size="xl" rounded="rounded-xl" />
              </Link>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-3">
                  <Link href={href} className="truncate text-xl font-semibold leading-tight text-text-primary hover:underline">
                    {parent.name}
                  </Link>
                  <JoinWord joined={isJoined(parent.id)} onJoin={() => onJoin(parent)} />
                </div>
                <p className="mt-1 flex items-center gap-1.5 text-[13px] text-text-secondary">
                  {country && <CountryFlagIcon code={country} className="h-[11px] w-[15px]" />}
                  <span className="truncate">
                    {formatMemberCount(parent.memberCount)} members · {children.length} {children.length === 1 ? 'space' : 'spaces'}
                    {parent.location ? ` · ${parent.location}` : ''}
                  </span>
                </p>
                {parent.description && (
                  <p className="mt-1 line-clamp-2 max-w-2xl text-[13px] leading-[1.35] text-text-muted">{parent.description}</p>
                )}
              </div>
            </div>

            {/* The branch, hanging from the head on a hairline. */}
            <div className="ml-8 mt-4 border-l-2 border-border-subtle pl-6">
              <div style={BRANCH_GRID}>
                {children.map((child) => (
                  <SpaceTile
                    key={child.id}
                    space={child}
                    mark={{ name: parent.name, imageUrl: parent.imageUrl }}
                    parentName={null}
                    joined={isJoined(child.id)}
                    onJoin={onJoin}
                    compact
                  />
                ))}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
