'use client';

import { useMemo } from 'react';
import { Calendar, MapPin, Users, Video, Pencil } from 'lucide-react';
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

interface CommunityInfo {
  name: string;
  imageUrl?: string | null;
}

interface EventsFeedViewProps {
  events: EventWithStats[];
  community?: CommunityInfo;
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
  community,
  featured,
  onEdit,
  onClick,
}: {
  event: EventWithStats;
  community?: CommunityInfo;
  featured?: boolean;
  onEdit?: (id: string) => void;
  onClick?: (event: EventWithStats) => void;
}) {
  const cover = getCoverImage(event);
  const status = getEventStatus(event.startAt, event.endAt);
  const isVirtual = !event.location || event.location.lat == null;
  const attendeeCount = event._stats?.totalAttendees ?? 0;
  const rel = startsInLabel(event.startAt);

  return (
    <div className={`group relative rounded-2xl border border-border-default bg-surface-1 overflow-hidden hover:shadow-md transition-all ${status === 'past' ? 'opacity-80' : ''}`}>
      <button
        type="button"
        onClick={() => onClick?.(event)}
        className="block w-full text-left"
      >
        {cover && (
          <img
            src={cover}
            alt={event.title}
            className={`w-full object-cover ${featured ? 'h-64' : 'h-40'}`}
          />
        )}

        <div className="p-5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <h3 className={`font-semibold text-brand-black group-hover:text-brand-green transition-colors ${featured ? 'text-xl' : 'text-lg'}`}>
              {event.title}
            </h3>
            <span className="flex-shrink-0 px-3 py-1 text-xs font-semibold rounded-full bg-brand-orange text-white">
              RSVP
            </span>
          </div>

          <div className="space-y-0.5">
            <p className="text-sm font-medium text-text-secondary">
              {formatFullDate(event.startAt, event.endAt)}
            </p>
            {community && (
              <div className="flex items-center gap-1.5 text-sm text-text-muted">
                <Avatar name={community.name} imageUrl={community.imageUrl} size="xs" />
                {community.name} community
              </div>
            )}
          </div>

          {event.description && (
            <p className={`text-sm text-text-secondary leading-relaxed ${featured ? 'line-clamp-3' : 'line-clamp-2'}`}>
              {event.description}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {rel && status !== 'past' && (
              <span className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full bg-brand-light-bg text-brand-dark-green">
                {rel}
              </span>
            )}
            {status === 'past' && (
              <span className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full bg-surface-2 text-text-muted">
                Past event
              </span>
            )}
            {isVirtual ? (
              <span className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full bg-surface-2 text-text-secondary border border-border-subtle">
                <Video className="w-3.5 h-3.5" />
                Virtual event
              </span>
            ) : (
              event.location && (
                <span className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full bg-surface-2 text-text-secondary border border-border-subtle truncate max-w-[220px]">
                  <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                  {event.location.label}
                </span>
              )
            )}
            {attendeeCount > 0 && (
              <span className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full bg-surface-2 text-text-secondary border border-border-subtle">
                <Users className="w-3.5 h-3.5" />
                {attendeeCount} Attendee{attendeeCount === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </div>
      </button>

      {onEdit && (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit(event.id); }}
          className="absolute top-3 right-3 p-1.5 text-brand-grey hover:text-brand-green hover:bg-brand-light-bg rounded-lg transition-all opacity-0 group-hover:opacity-100 bg-surface-1/80 backdrop-blur-sm"
          title="Edit event"
        >
          <Pencil className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

export default function EventsFeedView({ events, community, loading = false, onEdit, onEventClick }: EventsFeedViewProps) {
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
        <div className="h-64 rounded-2xl bg-surface-2 animate-pulse" />
        <div className="h-48 rounded-2xl bg-surface-2 animate-pulse" />
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="max-w-3xl mx-auto text-center py-20">
        <Calendar className="w-14 h-14 text-brand-grey mx-auto mb-4" />
        <p className="text-sm text-text-muted">No events found</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-10">
      {undated.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-brand-black">Date to be set</h2>
          <div className="space-y-4">
            {undated.map(ev => (
              <FeedCard key={ev.id} event={ev} community={community} onEdit={onEdit} onClick={onEventClick} />
            ))}
          </div>
        </section>
      )}

      {nextEvent && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-brand-black">Next event</h2>
          <FeedCard event={nextEvent} community={community} featured onEdit={onEdit} onClick={onEventClick} />
        </section>
      )}

      {Object.entries(upcomingByMonth).map(([month, monthEvents]) => (
        <section key={month} className="space-y-3">
          <h2 className="text-lg font-semibold text-brand-black">{month}</h2>
          <div className="space-y-4">
            {monthEvents.map(ev => (
              <FeedCard key={ev.id} event={ev} community={community} onEdit={onEdit} onClick={onEventClick} />
            ))}
          </div>
        </section>
      ))}

      {pastEvents.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-text-muted">Past events</h2>
          <div className="space-y-4">
            {pastEvents.map(ev => (
              <FeedCard key={ev.id} event={ev} community={community} onEdit={onEdit} onClick={onEventClick} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
