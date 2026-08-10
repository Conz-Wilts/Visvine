'use client';

/**
 * Edit an existing event — reuses the EventComposer in `edit` mode.
 */

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCommunity } from '@/features/shared/contexts/CommunityContext';
import { EventComposer } from '@/features/events/components/EventComposer';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { NBEvent } from '@/lib/types';

export default function EditEventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const router = useRouter();
  const { currentCommunity } = useCommunity();
  const [event, setEvent] = useState<NBEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  return wrap(
    <>
      <EventComposer
        communityId={currentCommunity.id}
        mode="edit"
        initialEvent={event}
        onDelete={() => setConfirmingDelete(true)}
      />
      <ConfirmDialog
        open={confirmingDelete}
        title="Delete Event"
        body={<>Are you sure you want to delete <span className="font-semibold text-text-primary">{event.title}</span>? This action cannot be undone.</>}
        confirmLabel="Delete Event"
        destructive
        error={deleteError}
        closeOnBackdrop={false}
        closeOnEscape={false}
        onConfirm={async () => {
          setDeleteError(null);
          try {
            const response = await fetch(`/api/events/${event.id}?communityId=${currentCommunity.id}`, { method: 'DELETE' });
            if (!response.ok) {
              const data = await response.json();
              throw new Error(data.error || 'Failed to delete event');
            }
            router.push('/events');
          } catch (err) {
            setDeleteError(err instanceof Error ? err.message : 'Failed to delete event');
          }
        }}
        onClose={() => { setConfirmingDelete(false); setDeleteError(null); }}
      />
    </>
  );
}
