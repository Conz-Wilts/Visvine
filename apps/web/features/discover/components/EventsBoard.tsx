'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { EmptyState, Skeleton } from '@/components/ui';
import { useCardTilt } from '@/features/directory/hooks/useCardTilt';
import SpaceAvatar from '@/features/spaces/components/SpaceAvatar';
import { MapPinIcon, VideoIcon } from '@/features/shared/icons';
import { formatEventDateShort, formatEventTime, startsInLabel } from '@/lib/eventUtils';
import { getNodeTypeConfig } from '@/lib/types';
import {
  filterEvents,
  groupEventsByDay,
  type DiscoverEvent,
  type EventFormat,
  type EventWhen,
} from '@/lib/discover/filters';

const EVENT_COLOR = getNodeTypeConfig('event').color;

const GRID: React.CSSProperties = {
  display: 'grid',
  gap: '20px',
  gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
};

/**
 * The event board: every public upcoming event from every space, folded by
 * day and drawn as posters — a cover, or the date large on the host's colour.
 * When, format and where arrive from the toolbar. A poster opens the event's
 * public page.
 */
export default function EventsBoard({
  events,
  loading,
  error,
  search,
  when,
  format,
  countries,
}: {
  events: DiscoverEvent[];
  loading: boolean;
  error: string | null;
  search: string;
  when: EventWhen;
  format: EventFormat;
  countries: Set<string>;
}) {
  const days = useMemo(
    () => groupEventsByDay(filterEvents(events, { search, when, format, countries })),
    [events, search, when, format, countries],
  );
  const total = days.reduce((n, d) => n + d.events.length, 0);
  const hasFilter = when !== 'all' || format !== 'all' || countries.size > 0 || search.trim() !== '';

  if (loading) {
    return (
      <div style={GRID} className="w-full">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex w-full flex-col overflow-hidden rounded-2xl border-4 border-surface-3 bg-surface-1">
            <Skeleton className="aspect-[4/3] w-full rounded-none" />
            <div className="px-4 pt-3 pb-4"><Skeleton className="h-4 w-3/4" /><Skeleton className="mt-2 h-3 w-1/2" /></div>
          </div>
        ))}
      </div>
    );
  }
  if (error) return <EmptyState title="Events are out of reach" description={error} />;
  if (total === 0) {
    return (
      <EmptyState
        title={hasFilter ? 'Nothing on for that' : 'Nothing on yet'}
        description={hasFilter ? 'Widen the window, or clear a filter.' : 'Public events from every space appear here as they are published.'}
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {days.map((day) => (
        <section key={day.key} aria-label={day.label}>
          <h2 className="flex items-baseline gap-2 pb-3">
            <span className="text-[15px] font-semibold text-text-primary">{day.label}</span>
            <span className="text-[13px] text-text-muted">{day.events.length} {day.events.length === 1 ? 'event' : 'events'}</span>
          </h2>
          <div style={GRID} className="w-full">
            {day.events.map((event) => <EventPoster key={event.id} event={event} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

/** One event as a tile: the poster on top, what and where under it. */
function EventPoster({ event }: { event: DiscoverEvent }) {
  const tiltRef = useCardTilt();
  const color = event.themeColor || EVENT_COLOR;
  const online = event.eventType === 'virtual';
  const { month, day } = formatEventDateShort(event.startAt);
  const soon = startsInLabel(event.startAt);
  const style = {
    borderColor: color,
    '--card-glow': `${color}55`,
    '--card-glow-strong': `${color}99`,
  } as React.CSSProperties;

  return (
    <Link
      ref={tiltRef as React.Ref<HTMLAnchorElement>}
      href={`/e/${encodeURIComponent(event.slug)}`}
      style={style}
      className="group relative z-0 flex w-full flex-col overflow-hidden rounded-2xl border-4 bg-surface-1 transition-[box-shadow,transform] duration-200 hover:z-10 active:scale-[0.98] [box-shadow:0_6px_16px_rgba(0,0,0,0.08),0_0_12px_2px_var(--card-glow)] hover:[box-shadow:0_16px_32px_rgba(0,0,0,0.16),0_0_20px_4px_var(--card-glow-strong)]"
    >
      <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden">
        {event.coverImageUrl ? (
          <img
            src={event.coverImageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover object-center transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center text-white transition-all group-hover:brightness-105" style={{ background: color }}>
            <span className="text-[13px] font-bold uppercase tracking-widest opacity-90">{month}</span>
            <span className="font-open-sauce text-5xl font-bold leading-none tabular-nums drop-shadow-sm">{day}</span>
          </div>
        )}
        {/* The date rides the corner of a cover so a poster still says when. */}
        {event.coverImageUrl && (
          <span className="absolute left-2.5 top-2.5 flex flex-col items-center rounded-lg bg-surface-1/95 px-2 py-1 leading-none shadow-strip">
            <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color }}>{month}</span>
            <span className="mt-0.5 text-base font-bold tabular-nums text-text-primary">{day}</span>
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col px-4 pt-3 pb-4">
        <h3 className="line-clamp-2 text-base font-semibold leading-tight text-text-primary">{event.title}</h3>
        <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-text-secondary">
          <span className="tabular-nums">{formatEventTime(event.startAt)}</span>
          <span aria-hidden>·</span>
          {online ? <VideoIcon className="h-3.5 w-3.5 shrink-0" /> : <MapPinIcon className="h-3.5 w-3.5 shrink-0" />}
          <span className="truncate">{online ? 'Online' : (event.locationLabel ?? 'In person')}</span>
        </p>
        <div className="mt-3 flex items-center justify-between gap-2">
          {event.spaceName ? (
            <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-text-muted">
              <SpaceAvatar name={event.spaceName} imageUrl={event.spaceImageUrl ?? undefined} size="sm" rounded="rounded" className="!h-4 !w-4 !text-[9px]" />
              <span className="truncate">{event.spaceName}</span>
            </span>
          ) : <span />}
          {soon && <span className="shrink-0 text-[12px] font-medium" style={{ color }}>{soon}</span>}
        </div>
      </div>
    </Link>
  );
}
