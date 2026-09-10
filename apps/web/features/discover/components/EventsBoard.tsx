'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { CountryFlagIcon, EmptyState, Skeleton } from '@/components/ui';
import { FilterDropdown } from '@/features/directory/components/FilterDropdown';
import SpaceAvatar from '@/features/spaces/components/SpaceAvatar';
import { MapPinIcon, VideoIcon } from '@/features/shared/icons';
import { formatEventTime, startsInLabel } from '@/lib/eventUtils';
import {
  countryOptions,
  filterEvents,
  groupEventsByDay,
  type DiscoverEvent,
  type EventFormat,
  type EventWhen,
} from '@/lib/discover/filters';
import FilterStrip from './FilterStrip';

const WHEN: Array<{ value: EventWhen; label: string }> = [
  { value: 'all', label: 'Upcoming' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
];

const FORMAT: Array<{ value: EventFormat; label: string }> = [
  { value: 'all', label: 'Any format' },
  { value: 'in-person', label: 'In person' },
  { value: 'virtual', label: 'Online' },
];

/**
 * The event board: every public upcoming event from every space, folded by
 * day and read top to bottom like a calendar. Narrowed by when, by format
 * and by where the host space is. A row opens the event's public page.
 */
export default function EventsBoard({
  events,
  loading,
  error,
  search,
  when,
  onWhen,
  format,
  onFormat,
  countries,
  onCountries,
}: {
  events: DiscoverEvent[];
  loading: boolean;
  error: string | null;
  search: string;
  when: EventWhen;
  onWhen: (next: EventWhen) => void;
  format: EventFormat;
  onFormat: (next: EventFormat) => void;
  countries: Set<string>;
  onCountries: (next: Set<string>) => void;
}) {
  const countryOpts = useMemo(() => countryOptions(events.map((e) => e.country)), [events]);
  const days = useMemo(
    () => groupEventsByDay(filterEvents(events, { search, when, format, countries })),
    [events, search, when, format, countries],
  );
  const total = days.reduce((n, d) => n + d.events.length, 0);
  const hasFilter = when !== 'all' || format !== 'all' || countries.size > 0 || search.trim() !== '';

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-1">
        <FilterStrip label="When" options={WHEN} value={when} onChange={(v) => onWhen(v as EventWhen)} />
        <div className="hidden h-6 w-px shrink-0 bg-border-subtle sm:block" />
        <FilterStrip label="Format" options={FORMAT} value={format} onChange={(v) => onFormat(v as EventFormat)} />
        {countryOpts.length > 0 && (
          <>
            <div className="hidden h-6 w-px shrink-0 bg-border-subtle sm:block" />
            <FilterDropdown
              label="Where"
              options={countryOpts.map((o) => ({ value: o.value, label: o.label, count: o.count }))}
              selected={countries}
              onChange={onCountries}
            />
          </>
        )}
      </div>

      {loading ? (
        <div className="space-y-3 pt-6">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full max-w-3xl rounded-lg" />)}
        </div>
      ) : error ? (
        <EmptyState title="Events are out of reach" description={error} />
      ) : total === 0 ? (
        <EmptyState
          title={hasFilter ? 'Nothing on for that' : 'Nothing on yet'}
          description={hasFilter ? 'Widen the window, or clear a filter.' : 'Public events from every space appear here as they are published.'}
        />
      ) : (
        <div className="max-w-3xl pt-4">
          {days.map((day) => (
            <section key={day.key} aria-label={day.label} className="pt-5 first:pt-2">
              <h2 className="flex items-baseline gap-2 pb-1">
                <span className="text-[13px] font-semibold text-text-primary">{day.label}</span>
                <span className="text-[12px] text-text-muted">{day.events.length} {day.events.length === 1 ? 'event' : 'events'}</span>
              </h2>
              <ul className="divide-y divide-border-subtle">
                {day.events.map((event) => <EventRow key={event.id} event={event} />)}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/** One event per row: the time, a poster if it has one, then what and where. */
function EventRow({ event }: { event: DiscoverEvent }) {
  const soon = startsInLabel(event.startAt);
  const online = event.eventType === 'virtual';
  return (
    <li>
      <Link
        href={`/e/${encodeURIComponent(event.slug)}`}
        className="-mx-2 flex items-center gap-4 rounded-lg px-2 py-3 transition-colors hover:bg-surface-2"
      >
        <span className="w-16 shrink-0 text-[13px] tabular-nums text-text-secondary">{formatEventTime(event.startAt)}</span>

        {event.coverImageUrl ? (
          <img src={event.coverImageUrl} alt="" className="h-14 w-20 shrink-0 rounded-md object-cover" loading="lazy" />
        ) : (
          <span className="flex h-14 w-20 shrink-0 items-center justify-center rounded-md bg-surface-2 text-text-muted">
            {online ? <VideoIcon className="h-4 w-4" /> : <MapPinIcon className="h-4 w-4" />}
          </span>
        )}

        <span className="min-w-0 flex-1">
          <b className="block truncate text-[14px] font-semibold text-text-primary">{event.title}</b>
          <span className="mt-0.5 flex items-center gap-1.5 text-[13px] text-text-muted">
            {event.spaceName && (
              <>
                <SpaceAvatar name={event.spaceName} imageUrl={event.spaceImageUrl ?? undefined} size="sm" rounded="rounded" className="!h-4 !w-4 !text-[9px]" />
                <span className="truncate">{event.spaceName}</span>
                <span aria-hidden>·</span>
              </>
            )}
            {event.country && <CountryFlagIcon code={event.country} className="h-[10px] w-[14px]" />}
            <span className="truncate">{online ? 'Online' : (event.locationLabel ?? 'In person')}</span>
          </span>
        </span>

        {soon && (
          <span className="hidden shrink-0 text-[12px] text-text-muted sm:block">{soon}</span>
        )}
      </Link>
    </li>
  );
}
