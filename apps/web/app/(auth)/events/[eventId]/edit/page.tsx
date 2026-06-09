'use client';

/**
 * Edit an existing event — reuses the EventComposer in `edit` mode.
 */

import { use, useEffect, useState } from 'react';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { EventComposer } from '@/components/events/EventComposer';
import type { NBEvent } from '@/lib/types';

export default function EditEventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const { currentCommunity } = useCommunity();
  const [event, setEvent] = useState<NBEvent | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentCommunity) return;
    setLoading(true);
    fetch(`/api/events/${eventId}?communityId=${currentCommunity.id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setEvent(d.event))
      .catch(() => setEvent(null))
      .finally(() => setLoading(false));
  }, [currentCommunity, eventId]);

  const wrap = (children: React.ReactNode) => (
    <div className="px-4 sm:px-6 lg:px-8 py-10">{children}</div>
  );

  if (!currentCommunity) return wrap(<p className="text-center text-brand-grey">Select a community to edit this event.</p>);
  if (loading) return wrap(<p className="text-center text-brand-grey">Loading…</p>);
  if (!event) return wrap(<p className="text-center text-brand-grey">Event not found.</p>);

  return wrap(<EventComposer communityId={currentCommunity.id} mode="edit" initialEvent={event} />);
}
