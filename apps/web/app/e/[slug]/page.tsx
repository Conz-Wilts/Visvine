/**
 * Public event page — the share target for visvine.com/e/<slug>. No login
 * required: anyone with the link sees the event and can RSVP. Server-rendered so
 * shared links resolve cleanly. Only `public` events are served here — space,
 * unlisted (private), and draft events 404 (they live behind the app's auth).
 */

import { notFound } from 'next/navigation';
import { getEventBySlug, getAttendees } from '@/lib/eventRepo';
import { formatEventDateRange, normalizeStatus, occupiedSpots } from '@/lib/eventUtils';
import { PublicRsvpForm } from '@/features/events/components/PublicRsvpForm';
import { CalendarIcon, MapPinIcon, UsersIcon, VideoIcon } from '@/features/shared/icons';
import type { Metadata } from 'next';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event || event.status === 'draft' || event.visibility !== 'public') return { title: 'Event' };
  return { title: `${event.title} · Visvine`, description: event.description?.slice(0, 160) };
}

export default async function PublicEventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event || event.status === 'draft' || event.visibility !== 'public') notFound();

  const attendees = await getAttendees(event.spaceId, event.id);
  const going = occupiedSpots(attendees);
  const guestNames = event.guestListVisible
    ? attendees
        .filter((a) => ['going', 'checked_in'].includes(normalizeStatus(a.status)) && a.response !== 'maybe')
        .map((a) => a.name)
        .filter((n): n is string => !!n)
    : [];

  const when = event.startAt ? formatEventDateRange(event.startAt, event.endAt, event.timezone) : '';
  const isVirtual = (event.metadata?.eventType as string) === 'virtual';
  // Always the brand green — per-event theme colors made event pages clash
  // with the rest of the app (matches EventDetailClient).
  const themeColor = '#78d870';

  return (
    <div className="min-h-screen bg-brand-light-bg/30">
      <div className="max-w-xl mx-auto px-4 py-8 sm:py-12">
        {/* cover */}
        <div
          className="w-full aspect-[16/9] rounded-lg overflow-hidden flex items-center justify-center text-white"
          style={event.coverImageUrl ? undefined : { background: themeColor }}
        >
          {event.coverImageUrl ? (
            <img src={event.coverImageUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="px-6 text-center text-xl font-bold drop-shadow">{event.title}</span>
          )}
        </div>

        <h1 className="mt-6 text-3xl font-bold text-brand-black">{event.title}</h1>

        <div className="mt-4 space-y-2.5 text-brand-black">
          {when && (
            <div className="flex items-start gap-3">
              <CalendarIcon className="w-5 h-5 text-brand-green mt-0.5 flex-shrink-0" />
              <span className="font-medium">{when}</span>
            </div>
          )}
          {(event.location?.label || isVirtual) && (
            <div className="flex items-start gap-3">
              {isVirtual ? <VideoIcon className="w-5 h-5 text-brand-green mt-0.5 flex-shrink-0" /> : <MapPinIcon className="w-5 h-5 text-brand-green mt-0.5 flex-shrink-0" />}
              <span>{event.location?.label || 'Online event'}</span>
            </div>
          )}
          <div className="flex items-start gap-3">
            <UsersIcon className="w-5 h-5 text-brand-green mt-0.5 flex-shrink-0" />
            <span>
              {going} going
              {event.capacity
                ? going >= event.capacity
                  ? ' · Event full'
                  : ` · ${event.capacity - going} spots left`
                : ''}
            </span>
          </div>
        </div>

        {event.description && (
          <p className="mt-5 text-brand-grey whitespace-pre-wrap leading-relaxed">{event.description}</p>
        )}

        <div className="mt-7">
          <PublicRsvpForm
            slug={slug}
            allowPlusOnes={event.allowPlusOnes ?? 0}
            allowedResponses={event.allowedResponses ?? ['going', 'maybe', 'declined']}
            formSchema={event.form?.schema ?? []}
            isFull={!!event.capacity && going >= event.capacity}
            waitlistEnabled={event.waitlistEnabled !== false}
            requireApproval={event.form?.requireApproval ?? false}
          />
        </div>

        {guestNames.length > 0 && (
          <div className="mt-7">
            <h2 className="text-sm font-semibold text-brand-black mb-2">Who&apos;s going</h2>
            <div className="flex flex-wrap gap-2">
              {guestNames.slice(0, 30).map((n, i) => (
                <span key={i} className="px-2.5 py-1 rounded-md bg-surface-2 text-sm text-text-primary">
                  {n}
                </span>
              ))}
              {guestNames.length > 30 && (
                <span className="px-3 py-1 text-sm text-brand-grey">+{guestNames.length - 30} more</span>
              )}
            </div>
          </div>
        )}

        <p className="mt-10 text-center text-xs text-brand-grey">Powered by Visvine</p>
      </div>
    </div>
  );
}
