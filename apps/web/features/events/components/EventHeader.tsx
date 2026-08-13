'use client';

/**
 * Event header component with title, date, location, and badges
 */

import { formatEventDateRange, isEventPast } from '@/lib/eventUtils';
import type { NBEvent, EventVisibility } from '@/lib/types';
import { Calendar, MapPin } from 'lucide-react';

interface EventHeaderProps {
  event: NBEvent;
  attendeeCount?: number;
  showCapacity?: boolean;
}

const VISIBILITY_COLORS: Record<EventVisibility, string> = {
  public: 'bg-brand-light-bg text-brand-green',
  space: 'bg-brand-green text-brand-green',
  private: 'bg-gray-100 text-brand-grey',
};

export function EventHeader({ event, attendeeCount, showCapacity = true }: EventHeaderProps) {
  const dateRange = formatEventDateRange(event.startAt, event.endAt, event.timezone);
  const isPast = isEventPast(event.endAt, event.startAt);
  const capacityPercent = event.capacity && attendeeCount
    ? Math.min((attendeeCount / event.capacity) * 100, 100)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2.5">
        {isPast && (
          <span className="px-3 py-1.5 text-xs font-semibold rounded-full bg-gray-100 text-brand-grey">
            Past
          </span>
        )}
        <span className={`px-3 py-1.5 text-xs font-semibold rounded-full ${VISIBILITY_COLORS[event.visibility]}`}>
          {event.visibility}
        </span>
        {event.form.requireApproval && (
          <span className="px-3 py-1.5 text-xs font-semibold rounded-full bg-brand-green/10 text-brand-green border border-brand-green/20">
            Requires Approval
          </span>
        )}
      </div>

      <div>
        <h1 className="text-4xl font-bold text-brand-black">
          {event.title}
        </h1>
        {event.description && (
          <p className="mt-3 text-brand-grey leading-relaxed">
            {event.description}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3 text-sm text-brand-grey">
        <div className="flex items-center gap-2.5">
          <Calendar className="w-5 h-5 text-brand-green" />
          <span>{dateRange}</span>
        </div>
        {event.location && (
          <div className="flex items-center gap-2.5">
            <MapPin className="w-5 h-5 text-brand-green" />
            <span>{event.location.label}</span>
          </div>
        )}
      </div>

      {showCapacity && event.capacity && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-brand-grey font-medium">
              {attendeeCount || 0} / {event.capacity} registered
            </span>
            <span className="text-brand-green font-bold">
              {Math.round(capacityPercent)}%
            </span>
          </div>
          <div className="w-full h-3 bg-brand-light-bg rounded-full overflow-hidden border border-brand-green">
            <div
              className="h-full bg-brand-green transition-all duration-300"
              style={{ width: `${capacityPercent}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

