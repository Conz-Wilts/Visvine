'use client';

/**
 * Events page - supports Calendar, Grid, and Map views
 * Layout matches Directory page pattern: header row + filters row + content
 */

import { useState, useEffect, useMemo } from 'react';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { DeleteEventModal } from '@/components/events/DeleteEventModal';
import { isEventUpcoming } from '@/lib/eventUtils';
import NodeDetailsSidebar from '@/components/graph/NodeDetailsSidebar';
import FullProfileOverlay from '@/components/profile/FullProfileOverlay';
import type { NBEvent, NBNode } from '@/lib/types';
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
  const { currentCommunity } = useCommunity();
  const [events, setEvents] = useState<EventWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState<EventView>('feed');
  const [timeFilter, setTimeFilter] = useState<'all' | 'upcoming' | 'past'>('all');
  const [locationFilter, setLocationFilter] = useState<'all' | 'in-person' | 'virtual'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteEventId, setDeleteEventId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<NBNode | null>(null);
  const [fullProfileNodeId, setFullProfileNodeId] = useState<string | null>(null);
  const [fullProfileInitialNode, setFullProfileInitialNode] = useState<NBNode | null>(null);

  const eventToNode = (event: NBEvent): NBNode => ({
    id: event.id,
    type: 'event',
    name: event.title,
    subtitle: event.description,
    location: event.location?.label,
    tags: [],
    metadata: (event.metadata ?? {}) as Record<string, unknown>,
    community_id: event.communityId,
  });

  const handleEventClick = (event: NBEvent) => {
    setSelectedNode(eventToNode(event));
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
      {/* Header row: stacks on mobile, centered title + view switcher right on md+ */}
      <div className="flex flex-col items-center gap-3 px-4 sm:px-6 pt-6 pb-0 md:grid md:grid-cols-[1fr_auto_1fr] md:items-center md:gap-4">
        <div className="hidden md:block" />
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-normal tracking-tight text-text-primary font-ginto text-center">Events</h1>
        <div className="md:justify-self-end">
          <EventsViewSelector currentView={currentView} onViewChange={setCurrentView} />
        </div>
      </div>

      {/* Filters row */}
      <div className="px-4 sm:px-6 pt-3 pb-1">
        <EventsToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          currentFilter={timeFilter}
          onFilterChange={setTimeFilter}
          locationFilter={locationFilter}
          onLocationFilterChange={setLocationFilter}
        />
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

      <NodeDetailsSidebar
        node={selectedNode}
        onClose={() => setSelectedNode(null)}
        onExpandToFullPage={(node) => {
          setFullProfileNodeId(node.id);
          setFullProfileInitialNode(node);
          setTimeout(() => setSelectedNode(null), 150);
        }}
      />

      <FullProfileOverlay
        nodeId={fullProfileNodeId}
        initialNode={fullProfileInitialNode ?? undefined}
        onClose={() => { setFullProfileNodeId(null); setFullProfileInitialNode(null); }}
      />

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
