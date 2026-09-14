'use client';

/**
 * A person's time on Visvine, drawn the way LinkedIn draws a position: the
 * logo beside the space, the role, the dates and tenure, and — while it
 * is still current — a description under them.
 */

import Image from 'next/image';

const VISVINE_DESCRIPTION =
  'Part of the Visvine community — the shared record of the people, spaces and events across the ecosystem, '
  + 'kept up to date by the members who make it.';

export default function ExperienceTimeline({ accountCreatedAt }: { accountCreatedAt: string | null }) {
  if (!accountCreatedAt) return null;
  return (
    <ExperienceEntry
      logo={<Image src="/images/brand-icon.png" alt="" width={48} height={48} className="w-12 h-12 rounded-lg object-cover" />}
      space="Visvine"
      role="Member"
      since={new Date(accountCreatedAt)}
      until={null}
      description={VISVINE_DESCRIPTION}
    />
  );
}

function ExperienceEntry({ logo, space, role, since, until, description }: {
  logo: React.ReactNode; space: string; role: string;
  since: Date; until: Date | null; description?: string;
}) {
  const range = `${monthYear(since)} – ${until ? monthYear(until) : 'Present'} · ${tenure(since, until ?? new Date())}`;
  const showDescription = !until && !!description;

  return (
    <div className="flex gap-3 pb-5">
      <div className="flex-none">{logo}</div>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="text-[15px] font-bold font-open-sauce text-text-primary">{space}</div>
        <div className="text-sm text-text-secondary">{role}</div>
        <div className="text-sm text-text-muted">{range}</div>
        {showDescription && (
          <p className="mt-2 text-sm text-text-secondary leading-relaxed max-w-[72ch]">{description}</p>
        )}
      </div>
    </div>
  );
}

const monthYear = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

/** "1 yr 6 mos", counting the starting month, the way LinkedIn states a tenure. */
function tenure(from: Date, to: Date): string {
  const months = Math.max(0, (to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth()) + 1;
  const yrs = Math.floor(months / 12);
  const mos = months % 12;
  return [
    yrs > 0 ? `${yrs} yr${yrs === 1 ? '' : 's'}` : '',
    mos > 0 ? `${mos} mo${mos === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' ');
}
