/**
 * Event manage page — the organizer view (host toolbar, analytics, and the
 * Overview / Guests / Form tabs). Reached via the "Edit event" button on the
 * event page; the guest-data and mutation APIs enforce host/admin permissions
 * server-side. See EventDetailClient.
 */

import EventDetailClient from '@/features/events/components/EventDetailClient';

export default async function EventManagePage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return <EventDetailClient eventId={decodeURIComponent(eventId)} manage />;
}
