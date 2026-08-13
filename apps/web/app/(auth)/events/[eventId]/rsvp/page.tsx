'use client';

/**
 * Public RSVP form page
 */

import { useState, useEffect, use } from 'react';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { RSVPForm } from '@/features/events/components/RSVPForm';
import { EventHeader } from '@/features/events/components/EventHeader';
import type { NBEvent } from '@/lib/types';

export default function RSVPPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const resolvedParams = use(params);
  const { currentSpace } = useSpace();
  const [event, setEvent] = useState<NBEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentSpace) return;

    const loadEvent = async () => {
      try {
        setLoading(true);
        const response = await fetch(
          `/api/events/${resolvedParams.eventId}?spaceId=${currentSpace.id}`
        );

        if (!response.ok) {
          throw new Error('Event not found');
        }

        const data = await response.json();
        setEvent(data.event);

        if (!data.event.form.enabled) {
          setError('RSVP form is not enabled for this event');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load event');
      } finally {
        setLoading(false);
      }
    };

    loadEvent();
  }, [currentSpace, resolvedParams.eventId]);

  if (!currentSpace) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <p className="text-center text-brand-grey">
          Please select a space to RSVP.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <p className="text-center text-brand-grey">Loading event...</p>
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <p className="text-center text-brand-green font-medium">
          {error || 'Event not found'}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="space-y-10">
        <EventHeader event={event} showCapacity={false} />

        <div className="border-t border-gray-200 pt-10">
          <h2 className="text-3xl font-bold text-brand-black mb-8">
            Register for this event
          </h2>
          <RSVPForm event={event} spaceId={currentSpace.id} />
        </div>
      </div>
    </div>
  );
}

