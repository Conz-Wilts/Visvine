'use client';

/**
 * Edit an existing event in the EventComposer.
 */

import { use, useEffect, useState } from 'react';
import { fetchJson } from '@/lib/fetchJson';
import { useSpaceRouter } from '@/features/shared/hooks/useSpaceRouter';
import { invalidateEventDetail, loadEventDetail } from '@/features/events/lib/eventDetail';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { EventComposer } from '@/features/events/components/EventComposer';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { NBEvent } from '@/lib/types';
import PageError from '@/components/ui/PageError';

export default function EditEventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const router = useSpaceRouter();
  const { currentSpace } = useSpace();
  const [event, setEvent] = useState<NBEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // The same read the event page just made, from the same cache.
  const spaceId = currentSpace?.id ?? null;
  useEffect(() => {
    if (!spaceId) return;
    let live = true;
    setLoading(true);
    loadEventDetail(spaceId, eventId, (d) => {
      if (!live) return;
      setEvent(d.event ?? null);
      setLoading(false);
    }).catch(() => {
      if (!live) return;
      setEvent(null);
      setLoading(false);
    });
    return () => { live = false; };
  }, [spaceId, eventId]);

  const wrap = (children: React.ReactNode) => (
    <div className="px-4 sm:px-6 lg:px-8 py-10">{children}</div>
  );

  if (!currentSpace) return wrap(<p className="text-center text-brand-grey">Select a space to edit this event.</p>);
  if (loading) return wrap(<p className="text-center text-brand-grey">Loading…</p>);
  if (!event) return wrap(<PageError size="inline" message="Couldn't load this event." onRetry={() => window.location.reload()} />);

  return wrap(
    <>
      <EventComposer
        spaceId={currentSpace.id}
        initialEvent={event}
        onDelete={() => setConfirmingDelete(true)}
      />
      <ConfirmDialog
        open={confirmingDelete}
        title={`Delete ${event.title}?`}
        body="This cannot be undone."
        confirmLabel="Delete"
        destructive
        error={deleteError}
        closeOnBackdrop={false}
        closeOnEscape={false}
        onConfirm={async () => {
          setDeleteError(null);
          try {
            await fetchJson(`/api/events/${event.id}?spaceId=${currentSpace.id}`, { method: 'DELETE' });
            invalidateEventDetail(event.id);
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
