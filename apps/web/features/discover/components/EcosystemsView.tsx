'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import SpaceAvatar from '@/features/spaces/components/SpaceAvatar';
import { CountryFlagIcon, EmptyState } from '@/components/ui';
import { ecosystemsOf, filterSpaces, spaceCountryCode } from '@/lib/discover/filters';
import type { Space } from '@/lib/types';
import JoinWord from './JoinWord';
import { formatMemberCount } from './SpaceCard';

/**
 * A space with sub-spaces is an ecosystem: a network, an accelerator, a fund
 * and its portfolio. Each is drawn as a head — the parent, with its mark and
 * its facts — and the branch under it, one line per sub-space, hanging from a
 * hairline the way the rail draws them. Join works at either level.
 */
export default function EcosystemsView({
  spaces,
  search,
  isJoined,
  onJoin,
}: {
  spaces: Space[];
  search: string;
  isJoined: (id: string) => boolean;
  onJoin: (space: Space) => void;
}) {
  const ecosystems = useMemo(() => {
    const all = ecosystemsOf(spaces);
    const q = search.trim();
    if (!q) return all;
    // A search keeps an ecosystem when the head or any branch matches, and
    // trims the branch to the matching rooms.
    return all.flatMap((eco) => {
      if (filterSpaces([eco.parent], { search: q }).length > 0) return [eco];
      const children = filterSpaces(eco.children, { search: q });
      return children.length > 0 ? [{ ...eco, children }] : [];
    });
  }, [spaces, search]);

  if (ecosystems.length === 0) {
    return (
      <EmptyState
        title={search.trim() ? 'No ecosystems match' : 'No ecosystems yet'}
        description={search.trim() ? 'Try a wider search.' : 'A space with open sub-spaces shows up here as one tree.'}
      />
    );
  }

  return (
    <div className="grid gap-x-10 gap-y-10 pt-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
      {ecosystems.map(({ parent, children }) => {
        const country = spaceCountryCode(parent);
        const href = `/communities/${encodeURIComponent(parent.id)}`;
        return (
          <section key={parent.id} aria-label={parent.name}>
            <div className="flex items-start gap-3">
              <Link href={href} className="shrink-0">
                <SpaceAvatar name={parent.name} imageUrl={parent.imageUrl} size="lg" rounded="rounded-lg" />
              </Link>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <Link href={href} className="truncate text-[15px] font-semibold leading-tight text-text-primary hover:underline">
                    {parent.name}
                  </Link>
                  <JoinWord joined={isJoined(parent.id)} onJoin={() => onJoin(parent)} />
                </div>
                <p className="mt-1 flex items-center gap-1.5 text-[13px] text-text-muted">
                  {country && <CountryFlagIcon code={country} className="h-[11px] w-[15px]" />}
                  <span className="truncate">
                    {formatMemberCount(parent.memberCount)} members · {children.length} {children.length === 1 ? 'space' : 'spaces'}
                    {parent.location ? ` · ${parent.location}` : ''}
                  </span>
                </p>
                {parent.description && (
                  <p className="mt-1 line-clamp-2 text-[13px] leading-[1.35] text-text-secondary">{parent.description}</p>
                )}
              </div>
            </div>

            {/* The branch: hangs from the head's mark on a hairline. */}
            <ul className="ml-6 mt-3 border-l border-border-subtle pl-5">
              {children.map((child) => (
                <li key={child.id} className="flex items-center gap-3 py-1.5">
                  {/* A sub-space wears its parent's mark; its name is what tells them apart. */}
                  <SpaceAvatar name={parent.name} imageUrl={parent.imageUrl} size="sm" rounded="rounded-md" />
                  <Link
                    href={`/communities/${encodeURIComponent(child.id)}`}
                    className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-text-primary hover:underline"
                  >
                    {child.name}
                  </Link>
                  <span className="shrink-0 text-[12px] tabular-nums text-text-muted">{formatMemberCount(child.memberCount)}</span>
                  <JoinWord joined={isJoined(child.id)} onJoin={() => onJoin(child)} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
