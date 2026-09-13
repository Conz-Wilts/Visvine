'use client';

/**
 * A person's time on Visvine, drawn the way LinkedIn draws a company: the
 * logo, the name and the whole tenure, then the role underneath on a dot.
 */

import Image from 'next/image';

export default function ExperienceTimeline({ accountCreatedAt }: { accountCreatedAt: string | null }) {
  if (!accountCreatedAt) return null;
  const tenure = tenureOf(new Date(accountCreatedAt));

  return (
    <div className="pb-5">
      <div className="flex gap-3">
        <Image src="/images/brand-icon.png" alt="" width={48} height={48}
               className="w-12 h-12 flex-none rounded-lg object-cover" />
        <div className="min-w-0 pt-0.5">
          <div className="text-[15px] font-bold font-open-sauce text-text-primary">Visvine</div>
          <div className="text-sm text-text-secondary">{tenure.duration}</div>
        </div>
      </div>
      <div className="relative mt-3 pl-[60px]">
        <span aria-hidden className="absolute left-6 top-[7px] w-2 h-2 -translate-x-1/2 rounded-full bg-text-muted/60" />
        <div className="text-[15px] font-bold font-open-sauce text-text-primary">Joined Visvine</div>
        <div className="text-sm text-text-secondary">Member</div>
        <div className="text-sm text-text-muted">{tenure.since} – Present · {tenure.duration}</div>
      </div>
    </div>
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
