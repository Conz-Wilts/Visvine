'use client';

/**
 * Create new event page
 */

import { useCommunity } from '@/lib/contexts/CommunityContext';
import { EventComposer } from '@/components/events/EventComposer';

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
    <div className="px-4 sm:px-6 lg:px-8 py-10">
      <EventComposer communityId={currentCommunity.id} mode="create" />
    </div>
  );
}

