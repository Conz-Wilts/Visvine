'use client';

import { useMemo } from 'react';
import { CalendarIcon, PencilIcon } from '@/features/shared/icons';
import { formatEventTime, getEventStatus, isEventUpcoming, startsInLabel } from '@/lib/eventUtils';
import Avatar from '@/components/ui/Avatar';
import type { NBEvent } from '@/lib/types';

interface EventWithStats extends NBEvent {
  _stats?: {
    totalAttendees: number;
    registered: number;
    waitlisted: number;
    checkedIn: number;
  };
}

interface SpaceInfo {
  name: string;
  imageUrl?: string | null;
}

interface EventsFeedViewProps {
  events: EventWithStats[];
  space?: SpaceInfo;
  loading?: boolean;
  onEdit?: (eventId: string) => void;
  onEventClick?: (event: EventWithStats) => void;
}

function getCoverImage(event: NBEvent): string | null {
  const url = (event.metadata as Record<string, unknown> | undefined)?.coverImageUrl;
  return typeof url === 'string' && url.length > 0 ? url : null;
}

function formatFullDate(startAt: string, endAt?: string): string {
  // An event that exists but isn't scheduled yet — created note-first, its date
  // still to be set on this page. Says so, rather than "Invalid Date".
  if (!startAt) return 'No date yet';
  const start = new Date(startAt);
  const datePart = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const startTime = formatEventTime(startAt);
  if (endAt) {
    const endTime = formatEventTime(endAt);
    return `${datePart}, ${startTime} – ${endTime}`;
  }
  return `${datePart}, ${startTime}`;
}

function monthKey(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function FeedCard({
  event,
  space,
  featured,
  onEdit,
  onClick,
}: {
  event: EventWithStats;
  space?: SpaceInfo;
  featured?: boolean;
  onEdit?: (id: string) => void;
  onClick?: (event: EventWithStats) => void;
}) {
  const cover = getCoverImage(event);
  const status = getEventStatus(event.startAt, event.endAt);
  const isVirtual = !event.location || event.location.lat == null;
  const attendeeCount = event._stats?.totalAttendees ?? 0;
  const rel = status !== 'past' ? startsInLabel(event.startAt) : null;

  // Everything the old badges said, as one line of text under the title:
  // when · where · how many. The countdown leads it in the accent when there
  // is one; a past event just dims.
  const facts = [
    formatFullDate(event.startAt, event.endAt),
    isVirtual ? 'Virtual' : event.location?.label,
    attendeeCount > 0 ? `${attendeeCount} going` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className={`group relative py-5 ${status === 'past' ? 'opacity-70' : ''}`}>
      <button
        type="button"
        onClick={() => onClick?.(event)}
        className="block w-full text-left"
      >
        {cover && (
          <img
            src={cover}
            alt={event.title}
            className={`mb-4 w-full rounded-lg object-cover ${featured ? 'h-72' : 'h-44'}`}
          />
        )}

        <h3 className={`font-semibold text-text-primary leading-snug group-hover:underline ${featured ? 'text-xl' : 'text-[17px]'}`}>
          {event.title}
        </h3>

        <p className="mt-1 text-sm text-text-secondary">
          {rel && <span className="font-semibold text-brand-dark-green">{rel} · </span>}
          {facts}
        </p>

        {space && (
          <div className="mt-1 flex items-center gap-1.5 text-[13px] text-text-muted">
            <Avatar name={space.name} imageUrl={space.imageUrl} size="xs" />
            {space.name}
          </div>
        )}

        {event.description && (
          <p className={`mt-2 text-sm leading-relaxed text-text-secondary ${featured ? 'line-clamp-3' : 'line-clamp-2'}`}>
            {event.description}
          </p>
        )}
      </button>

      {onEdit && (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit(event.id); }}
          className="absolute top-5 right-0 rounded-lg p-1.5 text-text-muted opacity-0 transition-all hover:bg-surface-3 hover:text-text-primary group-hover:opacity-100"
          title="Edit event"
        >
          <PencilIcon className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

export default function EventsFeedView({ events, space, loading = false, onEdit, onEventClick }: EventsFeedViewProps) {
  const { nextEvent, upcomingByMonth, pastEvents, undated } = useMemo(() => {
    // An event created from the context surface has a name and a note before it
    // has a schedule. It belongs at the TOP of the feed, not filtered out of
    // both halves — an event nobody can see is an event nobody will ever get
    // round to dating.
    const undatedEvents = events.filter(e => !e.startAt);
    const upcoming = events
      .filter(e => e.startAt && isEventUpcoming(e.startAt))
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    const past = events
      .filter(e => e.startAt && !isEventUpcoming(e.startAt))
      .sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime());

    const [next, ...rest] = upcoming;
    const grouped: Record<string, EventWithStats[]> = {};
    for (const ev of rest) {
      const key = monthKey(new Date(ev.startAt));
      (grouped[key] ||= []).push(ev);
    }
    return { nextEvent: next, upcomingByMonth: grouped, pastEvents: past, undated: undatedEvents };
  }, [events]);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="h-64 rounded-lg bg-surface-2 animate-pulse" />
        <div className="h-48 rounded-lg bg-surface-2 animate-pulse" />
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="max-w-3xl mx-auto text-center py-20">
        <CalendarIcon className="w-6 h-6 text-text-muted mx-auto mb-3" />
        <p className="text-sm text-text-muted">No events found</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {undated.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-text-muted">Date to be set</h2>
          <div className="divide-y divide-border-subtle">
            {undated.map(ev => (
              <FeedCard key={ev.id} event={ev} space={space} onEdit={onEdit} onClick={onEventClick} />
            ))}
          </div>
        </section>
      )}

      {nextEvent && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-text-muted">Next event</h2>
          <FeedCard event={nextEvent} space={space} featured onEdit={onEdit} onClick={onEventClick} />
        </section>
      )}

      {Object.entries(upcomingByMonth).map(([month, monthEvents]) => (
        <section key={month}>
          <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-text-muted">{month}</h2>
          <div className="divide-y divide-border-subtle">
            {monthEvents.map(ev => (
              <FeedCard key={ev.id} event={ev} space={space} onEdit={onEdit} onClick={onEventClick} />
            ))}
          </div>
        </section>
      ))}

      {pastEvents.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-text-muted">Past events</h2>
          <div className="divide-y divide-border-subtle">
            {pastEvents.map(ev => (
              <FeedCard key={ev.id} event={ev} space={space} onEdit={onEdit} onClick={onEventClick} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
