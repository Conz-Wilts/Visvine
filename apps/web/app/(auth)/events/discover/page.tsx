'use client';

/**
 * Global event discovery — where the navbar calendar lands when no space is
 * selected. Space-scoped events live at /events; this page is the one surface
 * that shows public events from every space, so it stays deliberately thin:
 * a search box and a card grid, same shape as the Directory grid.
 *
 * Cards link to the public /e/<slug> page rather than /events/<id>, because a
 * discovered event usually belongs to a space you're not a member of.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PageTitle, SearchInput, EmptyState, Skeleton } from '@/components/ui';
import { fetchJson } from '@/lib/fetchJson';
import { formatDate, formatTime } from '@/lib/date';

interface DiscoverEvent {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  startAt: string;
  locationLabel: string | null;
  coverImageUrl: string | null;
  communityName: string | null;
}

// Matches the Directory grid: fixed-width cards, auto-filled and evenly spread.
const GRID = 'grid gap-6 justify-center [grid-template-columns:repeat(auto-fill,260px)]';

function EventCard({ event }: { event: DiscoverEvent }) {
  return (
    <Link
      href={`/e/${event.slug}`}
      className="group flex h-[300px] w-full flex-col overflow-hidden rounded-2xl border border-border-default bg-surface-1 shadow-sm transition hover:shadow-md"
    >
      {event.coverImageUrl ? (
        <img
          src={event.coverImageUrl}
          alt={event.title}
          loading="lazy"
          className="h-[140px] shrink-0 object-cover transition-transform duration-300 group-hover:scale-105"
        />
      ) : (
        <div className="flex h-[140px] shrink-0 items-center justify-center bg-surface-2 text-text-muted">
          <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
      )}
      <div className="flex flex-1 flex-col gap-1 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-dark-green">
          {formatDate(event.startAt)} · {formatTime(event.startAt)}
        </p>
        <h3 className="line-clamp-2 text-sm font-semibold text-text-primary">{event.title}</h3>
        {event.locationLabel && (
          <p className="line-clamp-1 text-xs text-text-secondary">{event.locationLabel}</p>
        )}
        {event.communityName && (
          <p className="mt-auto line-clamp-1 text-xs text-text-muted">{event.communityName}</p>
        )}
      </div>
    </Link>
  );
}

export default function DiscoverEventsPage() {
  const [events, setEvents] = useState<DiscoverEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchJson<{ events: DiscoverEvent[] }>('/api/events/discover')
      .then((data) => {
        if (!cancelled) setEvents(data.events ?? []);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return events;
    return events.filter((e) =>
      [e.title, e.locationLabel, e.communityName, e.description]
        .some((field) => field?.toLowerCase().includes(q)),
    );
  }, [events, query]);

  return (
    <div className="w-full px-4 pb-8 sm:px-6">
      <PageTitle title="Discover events" />

      <div className="flex justify-center pt-6">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search public events…"
          className="w-full max-w-2xl"
        />
      </div>

      <div className="pt-6">
        {loading ? (
          <div className={GRID}>
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-[300px] w-full rounded-2xl" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No public events"
            description={
              events.length === 0
                ? 'No upcoming public events yet. Pick a space to see its own events.'
                : 'No events match that search.'
            }
          />
        ) : (
          <div className={GRID}>
            {filtered.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
