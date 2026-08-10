/**
 * Event page — always the guest-facing (public-style) view, regardless of who
 * is viewing. Organizer tools live behind the explicit "Edit event" button at
 * /events/[eventId]/manage. See EventDetailClient.
 */

import EventDetailClient from '@/features/events/components/EventDetailClient';

export default async function EventDetailPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return <EventDetailClient eventId={decodeURIComponent(eventId)} />;
}
