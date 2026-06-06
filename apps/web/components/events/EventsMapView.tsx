'use client';

/**
 * Map view for events
 * Displays events with physical locations as pins on a Leaflet map
 * Virtual events shown in a separate list
 */

import { useState, useMemo, type MouseEvent } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { formatEventDate, formatEventTime, isEventPast } from '@/lib/eventUtils';
import type { NBEvent } from '@/lib/types';
import { MapPin, Video, Calendar, Loader2 } from 'lucide-react';

// Dynamic import — Leaflet requires window
const EventMapInner = dynamic(() => import('./EventMapInner'), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center bg-surface-2">
      <div className="text-center">
        <Loader2 className="w-8 h-8 text-brand-green mx-auto mb-3 animate-spin" />
        <p className="text-sm text-brand-grey">Loading map...</p>
      </div>
    </div>
  ),
});

interface EventsMapViewProps {
  events: NBEvent[];
}

export default function EventsMapView({ events }: EventsMapViewProps) {
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const { physicalEvents, virtualEvents } = useMemo(() => {
    const physical: NBEvent[] = [];
    const virtual: NBEvent[] = [];
    events.forEach(event => {
      if (event.location && event.location.lat != null && event.location.lon != null) {
        physical.push(event);
      } else {
        virtual.push(event);
      }
    });
    return { physicalEvents: physical, virtualEvents: virtual };
  }, [events]);

  const selectedEvent = useMemo(() => {
    return physicalEvents.find(e => e.id === selectedEventId);
  }, [selectedEventId, physicalEvents]);

  return (
    <div className="space-y-6">
      {/* Map Container */}
      <div className="bg-surface-1 border border-border-subtle rounded-xl overflow-hidden">
        <div className="relative h-[500px]">
          {physicalEvents.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center bg-surface-2">
              <div className="text-center">
                <MapPin className="w-14 h-14 text-brand-grey mx-auto mb-4" />
                <p className="text-brand-grey text-lg font-semibold">No events with locations</p>
                <p className="text-brand-grey text-sm mt-2">
                  Add location coordinates to events to see them on the map
                </p>
              </div>
            </div>
          ) : (
            <>
              <EventMapInner
                events={physicalEvents}
                selectedEventId={selectedEventId}
                onSelectEvent={setSelectedEventId}
              />

              {/* Selected event preview card */}
              {selectedEvent && (
                <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 w-full max-w-md px-4 z-[1000] pointer-events-none">
                  <div className="bg-surface-1 rounded-lg shadow-xl border border-border-subtle p-4 pointer-events-auto">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <Link
                          href={`/events/${selectedEvent.id}`}
                          className="font-semibold text-brand-black hover:text-brand-green truncate block"
                        >
                          {selectedEvent.title}
                        </Link>
                        <p className="text-sm text-brand-grey mt-1">
                          {formatEventDate(selectedEvent.startAt)} at {formatEventTime(selectedEvent.startAt)}
                        </p>
                        {selectedEvent.location && (
                          <p className="text-sm text-brand-grey mt-1 flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {selectedEvent.location.label}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => setSelectedEventId(null)}
                        className="text-brand-grey hover:text-brand-black flex-shrink-0"
                        aria-label="Close preview"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Physical Events List */}
      {physicalEvents.length > 0 && (
        <div className="bg-surface-1 border border-border-subtle rounded-xl p-6">
          <h3 className="text-lg font-semibold text-brand-black mb-4 flex items-center gap-2">
            <MapPin className="w-5 h-5 text-brand-green" />
            In-Person Events ({physicalEvents.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {physicalEvents.map(event => {
              const isPastEvent = isEventPast(event.endAt, event.startAt);
              return (
                <button
                  key={event.id}
                  className={`text-left p-4 rounded-lg border transition-all ${
                    selectedEventId === event.id
                      ? 'border-brand-green bg-brand-light-bg shadow-sm'
                      : 'border-border-subtle hover:border-brand-green hover:shadow-sm'
                  } ${isPastEvent ? 'opacity-50' : ''}`}
                  onClick={() => setSelectedEventId(selectedEventId === event.id ? null : event.id)}
                >
                  <Link href={`/events/${event.id}`} onClick={(e: MouseEvent) => e.stopPropagation()}>
                    <h4 className="font-semibold text-brand-black truncate hover:text-brand-green transition-colors">{event.title}</h4>
                  </Link>
                  <p className="text-sm text-brand-grey mt-1">
                    {formatEventDate(event.startAt)} at {formatEventTime(event.startAt)}
                  </p>
                  {event.location && (
                    <p className="text-sm text-brand-grey mt-1 flex items-center gap-1 truncate">
                      <MapPin className="w-3 h-3 flex-shrink-0" />
                      {event.location.label}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Virtual Events List */}
      {virtualEvents.length > 0 && (
        <div className="bg-surface-1 border border-border-subtle rounded-xl p-6">
          <h3 className="text-lg font-semibold text-brand-black mb-4 flex items-center gap-2">
            <Video className="w-5 h-5 text-brand-green" />
            Virtual Events ({virtualEvents.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {virtualEvents.map(event => {
              const isPastEvent = isEventPast(event.endAt, event.startAt);
              return (
                <Link
                  key={event.id}
                  href={`/events/${event.id}`}
                  className={`p-4 rounded-lg border border-border-subtle hover:border-brand-green hover:shadow-sm transition-all ${
                    isPastEvent ? 'opacity-50' : ''
                  }`}
                >
                  <h4 className="font-semibold text-brand-black truncate">{event.title}</h4>
                  <p className="text-sm text-brand-grey mt-1">
                    {formatEventDate(event.startAt)} at {formatEventTime(event.startAt)}
                  </p>
                  <p className="text-sm text-brand-grey mt-1 flex items-center gap-1">
                    <Video className="w-3 h-3" />
                    Virtual
                  </p>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {physicalEvents.length === 0 && virtualEvents.length === 0 && (
        <div className="text-center py-20 bg-surface-1 rounded-xl border border-border-subtle">
          <Calendar className="w-14 h-14 text-brand-grey mx-auto mb-4" />
          <p className="text-lg font-semibold text-brand-black">No events found</p>
          <p className="text-sm text-brand-grey mt-2">Try adjusting your filters or search</p>
        </div>
      )}
    </div>
  );
}
