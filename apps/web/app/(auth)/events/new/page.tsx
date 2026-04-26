'use client';

/**
 * Create new event page
 */

import { useCommunity } from '@/lib/contexts/CommunityContext';
import { EventForm } from '@/components/events/EventForm';

export default function NewEventPage() {
  const { currentCommunity } = useCommunity();

  if (!currentCommunity) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <p className="text-center text-brand-grey">
          Please select a community to create an event.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-brand-black">
          Create New Event
        </h1>
        <p className="mt-2 text-brand-grey">
          Create a new event for {currentCommunity.name}
        </p>
      </div>

      <EventForm communityId={currentCommunity.id} mode="create" />
    </div>
  );
}

