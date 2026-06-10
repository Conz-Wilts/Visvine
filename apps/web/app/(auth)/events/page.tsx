'use client';

/**
 * Events page - supports Calendar, Grid, and Map views
 * Layout matches Directory page pattern: header row + filters row + content
 */

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { useHeader } from '@/lib/contexts/HeaderContext';
import { DeleteEventModal } from '@/components/events/DeleteEventModal';
import { isEventUpcoming } from '@/lib/eventUtils';
import type { NBEvent } from '@/lib/types';
import EventsToolbar from '@/components/events/EventsToolbar';
import EventsCalendarView from '@/components/events/EventsCalendarView';
import EventsFeedView from '@/components/events/EventsFeedView';
import EventsMapView from '@/components/events/EventsMapView';
import EventsViewSelector from '@/components/events/EventsViewSelector';
import type { EventView } from '@/components/events/EventsViewSelector';

interface EventWithStats extends NBEvent {
  _stats?: {
    totalAttendees: number;
    registered: number;
    waitlisted: number;
    checkedIn: number;
  };
}

export default function EventsPage() {
  const router = useRouter();
  const { currentCommunity } = useCommunity();
  const [events, setEvents] = useState<EventWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState<EventView>('feed');
  const [timeFilter, setTimeFilter] = useState<'all' | 'upcoming' | 'past'>('all');
  const [locationFilter, setLocationFilter] = useState<'all' | 'in-person' | 'virtual'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteEventId, setDeleteEventId] = useState<string | null>(null);
  const { setHeaderRight } = useHeader();

  // View toggle lives in the navbar, to the left of the profile icon (same as Directory).
  useEffect(() => {
    setHeaderRight(
      <EventsViewSelector currentView={currentView} onViewChange={setCurrentView} />
    );
    return () => setHeaderRight(null);
  }, [currentView, setHeaderRight]);

  const handleEventClick = (event: NBEvent) => {
    router.push(`/events/${event.id}`);
  };

  useEffect(() => {
    const loadEvents = async () => {
      if (!currentCommunity) return;
      try {
        setLoading(true);
        const response = await fetch(`/api/events?communityId=${currentCommunity.id}`);
        const data = await response.json();
        setEvents(data.events || []);
      } catch (error) {
        console.error('Failed to load events:', error);
      } finally {
        setLoading(false);
      }
    };

    loadEvents();
  }, [currentCommunity]);

  const reloadEvents = async () => {
    if (!currentCommunity) return;
    try {
      const response = await fetch(`/api/events?communityId=${currentCommunity.id}`);
      const data = await response.json();
      setEvents(data.events || []);
    } catch (error) {
      console.error('Failed to load events:', error);
    }
  };

  const handleDeleteSuccess = () => {
    setDeleteEventId(null);
    reloadEvents();
  };

  const deleteEvent = events.find((e) => e.id === deleteEventId);

  // Apply filters
  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      // Time filter
      if (timeFilter === 'upcoming') {
        if (!event.startAt || !isEventUpcoming(event.startAt)) return false;
      }
      if (timeFilter === 'past') {
        if (!event.startAt || isEventUpcoming(event.startAt)) return false;
      }

      // Location filter
      if (locationFilter === 'in-person') {
        if (!event.location || event.location.lat == null || event.location.lon == null) {
          return false;
        }
      } else if (locationFilter === 'virtual') {
        if (event.location && event.location.lat != null && event.location.lon != null) {
          return false;
        }
      }

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          event.title.toLowerCase().includes(query) ||
          event.description?.toLowerCase().includes(query) ||
          event.location?.label.toLowerCase().includes(query)
        );
      }

      return true;
    });
  }, [events, timeFilter, locationFilter, searchQuery]);

  if (!currentCommunity) {
    return (
      <div className="min-h-screen w-full py-8">
        <div className="w-full max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-center text-text-muted py-12">
            Please select a community to view events.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full" style={{ minHeight: 'calc(100dvh - 56px)' }}>
      {/* Header row: centered title (view switcher lives in the navbar) */}
      <div className="flex items-center justify-center px-4 sm:px-6 pt-6 pb-0 text-center">
        <h1 className="text-6xl font-normal tracking-tight text-text-primary font-ginto">Events</h1>
      </div>

      {/* Search bar — sized to match Directory */}
      <div className="flex justify-center px-4 sm:px-6 pt-6">
        <div className="w-full max-w-2xl">
          <div className="flex min-h-[56px] items-center gap-2.5 rounded-2xl border border-border-default bg-surface-1 px-4 shadow-sm">
            <svg className="h-4 w-4 shrink-0 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
            </svg>
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search events…"
              className="flex-1 bg-transparent text-base text-text-primary placeholder:text-text-muted focus:outline-none"
            />
            {searchQuery && (
              <button type="button" onClick={() => setSearchQuery('')} className="text-text-muted hover:text-text-secondary">
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Filters row */}
      <div className="flex justify-center px-4 sm:px-6 pt-4 pb-1">
        <div className="w-full max-w-2xl">
          <EventsToolbar
            currentFilter={timeFilter}
            onFilterChange={setTimeFilter}
            locationFilter={locationFilter}
            onLocationFilterChange={setLocationFilter}
          />
        </div>
      </div>

      {/* View Content */}
      <div className="px-4 sm:px-6 pt-4 pb-8">
        {currentView === 'calendar' && (
          <EventsCalendarView events={filteredEvents} onEventClick={handleEventClick} loading={loading} />
        )}

        {currentView === 'feed' && (
          <EventsFeedView
            events={filteredEvents}
            loading={loading}
            onDelete={(eventId) => setDeleteEventId(eventId)}
            onEventClick={handleEventClick}
          />
        )}

        {currentView === 'map' && (
          <EventsMapView events={filteredEvents} />
        )}
      </div>

      {/* Delete Modal */}
      {deleteEventId && deleteEvent && currentCommunity && (
        <DeleteEventModal
          eventTitle={deleteEvent.title}
          eventId={deleteEvent.id}
          communityId={currentCommunity.id}
          onClose={() => setDeleteEventId(null)}
          onSuccess={handleDeleteSuccess}
        />
      )}
    </div>
  );
}
