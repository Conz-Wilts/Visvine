'use client';

/**
 * Create new event page
 */

import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { EventComposer } from '@/features/events/components/EventComposer';

export default function NewEventPage() {
  const { currentSpace } = useSpace();

  if (!currentSpace) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <p className="text-center text-brand-grey">
          Please select a space to create an event.
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-10">
      <EventComposer spaceId={currentSpace.id} mode="create" />
    </div>
  );
}

