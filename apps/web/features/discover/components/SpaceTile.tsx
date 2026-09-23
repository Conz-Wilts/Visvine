'use client';

import Link from '@/features/shared/components/SpaceLink';
import { useSpaceRouter } from '@/features/shared/hooks/useSpaceRouter';
import { useCardTilt } from '@/features/directory/hooks/useCardTilt';
import { TypeSilhouette } from '@visvine/ui';
import CountryFlagIcon from '@/features/shared/components/CountryFlagIcon';
import { getNodeTypeConfig } from '@/lib/types';
import { spaceCountryCode } from '@/lib/discover/filters';
import type { Space } from '@/lib/types';
import JoinWord from './JoinWord';
import type { ViewerDoor } from '@/features/spaces/lib/viewerDoor';

function formatMemberCount(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return String(count);
}

/** The Space type's colour — the tile's glow and its painted field. */
export const SPACE_COLOR = getNodeTypeConfig('space').color;

/**
 * A space as the Directory draws an entry: a tile glowing in the Space
 * colour, a square of identity media (the mark, or the monogram on a painted
 * field), then name, one line of facts and the join word, centred. Sectors
 * are browsed from the strip above the grid. The tile opens the space's page.
 */
export default function SpaceTile({
  space,
  mark,
  parentName,
  joined,
  door = 'active',
  asked = false,
  onJoin,
}: {
  space: Space;
  /** The mark it wears — a sub-space wears its parent's (spaceMark). */
  mark: { name: string; imageUrl?: string };
  parentName: string | null;
  joined: boolean;
  /** The door this viewer meets (lib/spaces/subspaces.ts); defaults to open. */
  door?: ViewerDoor;
  asked?: boolean;
  onJoin: (space: Space) => void;
}) {
  const router = useSpaceRouter();
  const tiltRef = useCardTilt();
  const country = spaceCountryCode(space);
  const href = `/spaces/${encodeURIComponent(space.id)}`;
  const facts = [
    parentName ? `in ${parentName}` : null,
    `${formatMemberCount(space.memberCount)} ${space.memberCount === 1 ? 'member' : 'members'}`,
  ].filter(Boolean).join(' · ');

  const style = {
    '--card-glow': `${SPACE_COLOR}55`,
    '--card-glow-strong': `${SPACE_COLOR}99`,
  } as React.CSSProperties;

  return (
    <div
      ref={tiltRef}
      role="link"
      tabIndex={0}
      onClick={() => router.push(href)}
      onKeyDown={(e) => { if (e.key === 'Enter') router.push(href); }}
      style={style}
      className="group relative z-0 flex w-full cursor-pointer flex-col overflow-hidden rounded-2xl bg-surface transition-[box-shadow,transform] duration-200 hover:z-10 active:scale-[0.98] [box-shadow:0_6px_16px_rgba(0,0,0,0.08),0_0_12px_2px_var(--card-glow)] hover:[box-shadow:0_16px_32px_rgba(0,0,0,0.16),0_0_20px_4px_var(--card-glow-strong)]"
    >
      <div className="aspect-square w-full shrink-0 overflow-hidden">
        {mark.imageUrl ? (
          <img
            src={mark.imageUrl}
            alt={mark.name}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover object-center transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <TypeSilhouette glyph="space" color={SPACE_COLOR}
                          className="transition-all group-hover:brightness-105" />
        )}
      </div>

      <div className="flex flex-1 flex-col items-center gap-1 px-4 pt-3 pb-4 text-center">
        <Link
          href={href}
          onClick={(e) => e.stopPropagation()}
          className="line-clamp-1 text-base font-semibold leading-tight text-fg"
        >
          {space.name}
        </Link>
        <p className="flex max-w-full items-center justify-center gap-1.5 text-[13px] leading-[1.35] text-fg-muted">
          {country && <CountryFlagIcon code={country} className="h-[11px] w-[15px] shrink-0" />}
          <span className="truncate">{facts}</span>
        </p>
        <JoinWord joined={joined} door={door} asked={asked} onJoin={() => onJoin(space)} className="mt-1" />
      </div>
    </div>
  );
}
