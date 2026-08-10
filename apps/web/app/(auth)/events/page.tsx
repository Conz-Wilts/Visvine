'use client';

/**
 * Events page - supports Calendar and Feed views
 * Layout matches Directory page pattern: header row + filters row + content
 */

import { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCommunity } from '@/features/shared/contexts/CommunityContext';
import { useContextPanel } from '@/features/shared/contexts/ContextPanelContext';
import { useSession } from '@/features/auth/lib/auth-client';
import { isEventUpcoming } from '@/lib/eventUtils';
import type { NBEvent } from '@/lib/types';
import EventsToolbar from '@/features/events/components/EventsToolbar';
import EventsCalendarView from '@/features/events/components/EventsCalendarView';
import EventsFeedView from '@/features/events/components/EventsFeedView';
import EventsViewSelector from '@/features/events/components/EventsViewSelector';
import type { EventView } from '@/features/events/components/EventsViewSelector';
import EventsScopeSelector from '@/features/events/components/EventsScopeSelector';
import type { EventScope } from '@/features/events/components/EventsScopeSelector';
import { PageTitle } from '@/components/ui';
import PaneTopScrollbarMask from '@/features/shared/components/pane/PaneTopScrollbarMask';

interface EventWithStats extends NBEvent {
  _stats?: {
    totalAttendees: number;
    registered: number;
    waitlisted: number;
    checkedIn: number;
  };
}

function EventsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentCommunity } = useCommunity();
  const [events, setEvents] = useState<EventWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState<EventView>('feed');
  // ?scope=discover deep-links from the navbar's discover-events icon.
  const initialScope = searchParams.get('scope');
  const [scope, setScope] = useState<EventScope>(
    initialScope === 'discover' || initialScope === 'mine' ? initialScope : 'community'
  );
  const [timeFilter, setTimeFilter] = useState<'upcoming' | 'past'>('upcoming');
  const [locationFilter, setLocationFilter] = useState<'all' | 'in-person' | 'virtual'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Clicking the navbar icon while already on /events updates the param, not a
  // remount — keep the scope tab in sync with the URL.
  useEffect(() => {
    if (initialScope === 'discover' || initialScope === 'mine' || initialScope === 'community') {
      setScope(initialScope);
    }
  }, [initialScope]);
  const { data: session } = useSession();
  const myNodeId = session?.user?.nodeId;

  // The view switcher below bleeds over the sidebar card's top strip (z-[45]).
  // Publish its height so anything hosted in that card's panel column — the
  // Create panel — starts below it rather than behind it.
  const viewBarRef = useRef<HTMLDivElement | null>(null);
  const { setDockTopInset } = useContextPanel();
  useEffect(() => {
    setDockTopInset(viewBarRef.current?.offsetHeight ?? 0);
    return () => setDockTopInset(0);
  }, [setDockTopInset]);

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

  // Apply filters
  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      // Scope: "My events" = events I host; "Discover" = publicly discoverable
      // events; "Community" = everything in the current community.
      if (scope === 'mine') {
        if (!myNodeId || !event.hosts?.includes(myNodeId)) return false;
      } else if (scope === 'discover') {
        if (event.visibility !== 'public') return false;
      }

      // Time filter
      if (timeFilter === 'upcoming') {
        if (!event.startAt || !isEventUpcoming(event.startAt)) return false;
      }
      if (timeFilter === 'past') {
        if (!event.startAt || isEventUpcoming(event.startAt)) return false;
      }

      // Location filter — an event counts as in-person once it names a venue.
      if (locationFilter === 'in-person') {
        if (!event.location?.label) return false;
      } else if (locationFilter === 'virtual') {
        if (event.location?.label) return false;
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
  }, [events, scope, myNodeId, timeFilter, locationFilter, searchQuery]);

  if (!currentCommunity) {
    return (
      <div className="min-h-screen w-full py-8">
        <div className="w-full max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-center text-text-muted py-12">
            Please select a space to view events.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full">
      {/* View switcher pinned flush in the top-left corner — same treatment as
          the Directory's Grid / Context bar (PaneTabBar): the bar full-bleeds
          left into the sidebar seam and its bottom border runs edge to edge.
          "-top-4 -mt-4" cancels <main>'s pt-4 so it sits flush
          under the navbar (at rest and pinned); "-ml-[23px]" bleeds left to 1px
          shy of the rail edge so the sidebar's right border stays visible.
          UnderlineTabs draws its own bottom border, so the wrapper stays
          borderless. */}
      <div ref={viewBarRef} className="sticky -top-4 -mt-4 z-[45] -ml-[23px] bg-surface-1">
        {/* Keeps the page scrollbar from running up beside the pinned bar. */}
        <PaneTopScrollbarMask />
        <EventsViewSelector
          currentView={currentView}
          onViewChange={setCurrentView}
          className="w-full overflow-x-auto px-1"
        />
      </div>

      <PageTitle title="Events" />

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

      {/* Scope tabs: discover / community / events I host */}
      <div className="flex justify-center px-4 sm:px-6 pt-4">
        <EventsScopeSelector scope={scope} onScopeChange={setScope} />
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
            community={{ name: currentCommunity.name, imageUrl: currentCommunity.imageUrl }}
            loading={loading}
            onEdit={(eventId) => router.push(`/events/${eventId}/edit`)}
            onEventClick={handleEventClick}
          />
        )}
      </div>
    </div>
  );
}

export default function EventsPage() {
  // Suspense boundary: the inner page reads useSearchParams (?scope=).
  return (
    <Suspense fallback={null}>
      <EventsPageInner />
    </Suspense>
  );
}
