'use client';

import Link from 'next/link';
import SpaceAvatar from '@/features/spaces/components/SpaceAvatar';
import { CountryFlagIcon } from '@/components/ui';
import { spaceCountryCode } from '@/lib/discover/filters';
import type { Space } from '@/lib/types';
import JoinWord from './JoinWord';

export function formatMemberCount(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return String(count);
}

/**
 * The same shape as the directory's NodeCard: a bare square, then the name
 * and one line of facts underneath. The square opens the space's page; Join
 * is a word in the accent beside the name.
 */
export default function SpaceCard({
  space,
  mark,
  parentName,
  joined,
  onJoin,
}: {
  space: Space;
  /** The mark it wears — a sub-space wears its parent's (spaceMark). */
  mark: { name: string; imageUrl?: string };
  /** The space this one is a sub-space of, when the viewer can see it. */
  parentName: string | null;
  joined: boolean;
  onJoin: (space: Space) => void;
}) {
  const country = spaceCountryCode(space);
  const facts = [
    parentName ? `in ${parentName}` : null,
    `${formatMemberCount(space.memberCount)} ${space.memberCount === 1 ? 'member' : 'members'}`,
    space.location,
  ].filter(Boolean).join(' · ');
  const href = `/communities/${encodeURIComponent(space.id)}`;

  return (
    <div className="group flex w-full flex-col">
      <Link href={href} className="aspect-square w-full overflow-hidden rounded-lg">
        <SpaceAvatar
          name={mark.name}
          imageUrl={mark.imageUrl}
          className="h-full w-full !rounded-none transition-transform duration-300 group-hover:scale-[1.03]"
        />
      </Link>

      <div className="flex items-start justify-between gap-3 pt-2.5">
        <div className="min-w-0">
          <Link href={href} className="block truncate text-[15px] font-semibold leading-tight text-text-primary hover:underline">
            {space.name}
          </Link>
          <p className="mt-1 flex items-center gap-1.5 truncate text-[13px] text-text-muted">
            {country && <CountryFlagIcon code={country} className="inline-block h-[11px] w-[15px] shrink-0 rounded-[2px]" />}
            <span className="truncate">{facts}</span>
          </p>
          <p className="mt-1 line-clamp-2 text-[13px] leading-[1.35] text-text-secondary">
            {space.description || 'An emerging space waiting to be discovered.'}
          </p>
        </div>
        <JoinWord joined={joined} onJoin={() => onJoin(space)} className="pt-0.5" />
      </div>
    </div>
  );
}
