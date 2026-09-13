'use client';

/**
 * The spaces a person belongs to, read as a LinkedIn experience list: a logo,
 * the space, the standing held there and the tenure, newest first. Visvine
 * itself closes the list — every account is on Visvine before it is in any
 * space, so joining it is the first line of anyone's history.
 */

import Image from 'next/image';
import SpaceAvatar from '@/features/spaces/components/SpaceAvatar';
import type { ProfileSpace } from './SpacesModal';

interface Entry {
  key: string;
  name: string;
  logo: React.ReactNode;
  standing: string;
  since: Date;
}

export default function ExperienceTimeline({ spaces, accountCreatedAt }: {
  /** Already narrowed to the spaces this viewer may see on the profile. */
  spaces: ProfileSpace[];
  accountCreatedAt: string | null;
}) {
  const entries: Entry[] = spaces
    .map((s) => ({
      key: s.id,
      name: s.name,
      logo: <SpaceAvatar name={s.name} imageUrl={s.imageUrl ?? undefined} size="lg" rounded="rounded-lg" />,
      standing: s.isAdmin ? 'Admin' : 'Member',
      since: new Date(s.joinedAt),
    }))
    .sort((a, b) => b.since.getTime() - a.since.getTime());

  if (accountCreatedAt) {
    entries.push({
      key: 'visvine',
      name: 'Visvine',
      logo: <Image src="/images/brand-icon.png" alt="" width={48} height={48} className="w-12 h-12 rounded-lg object-cover" />,
      standing: 'Joined',
      since: new Date(accountCreatedAt),
    });
  }

  if (entries.length === 0) return null;

  return (
    <ol className="flex flex-col">
      {entries.map((e, i) => {
        const tenure = tenureOf(e.since);
        const last = i === entries.length - 1;
        return (
          <li key={e.key} className="relative flex gap-3 pb-5">
            <div className="flex-none">{e.logo}</div>
            {!last && (
              <span aria-hidden className="absolute left-6 top-14 bottom-1 w-0.5 -translate-x-1/2 rounded-full bg-border-subtle" />
            )}
            <div className="min-w-0 pt-0.5">
              <div className="text-[15px] font-bold font-open-sauce text-text-primary truncate">{e.name}</div>
              <div className="text-sm text-text-secondary">{e.standing}</div>
              <div className="text-sm text-text-muted">{tenure.since} – Present · {tenure.duration}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** "Oct 2025" and "1 yr 6 mos" for a start date, the way LinkedIn states a tenure. */
function tenureOf(date: Date): { since: string; duration: string } {
  const now = new Date();
  const months = Math.max(0, (now.getFullYear() - date.getFullYear()) * 12 + now.getMonth() - date.getMonth()) + 1;
  const yrs = Math.floor(months / 12);
  const mos = months % 12;
  const parts = [
    yrs > 0 ? `${yrs} yr${yrs === 1 ? '' : 's'}` : '',
    mos > 0 ? `${mos} mo${mos === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  return {
    since: date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }),
    duration: parts.join(' '),
  };
}
