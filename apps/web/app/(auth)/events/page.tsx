'use client';

/**
 * Events page — Calendar and Feed views over one filtered list.
 * Shape matches the Directory: a pane-top tab bar (the scope), then one toolbar
 * row (search, filters, view), then content.
 */

import { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import { fetchJson } from '@/lib/fetchJson';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
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
import { SearchInput } from '@/components/ui';
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
  const { currentSpace } = useSpace();
  const [events, setEvents] = useState<EventWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState<EventView>('feed');
  // ?scope=discover deep-links from the navbar's discover-events icon.
  const initialScope = searchParams.get('scope');
  const [scope, setScope] = useState<EventScope>(
    initialScope === 'discover' || initialScope === 'mine' ? initialScope : 'space'
  );
  const [timeFilter, setTimeFilter] = useState<'upcoming' | 'past'>('upcoming');
  const [locationFilter, setLocationFilter] = useState<'all' | 'in-person' | 'virtual'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Clicking the navbar icon while already on /events updates the param, not a
  // remount — keep the scope tab in sync with the URL.
  useEffect(() => {
    if (initialScope === 'discover' || initialScope === 'mine' || initialScope === 'space') {
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
      if (!currentSpace) return;
      try {
        setLoading(true);
        const data = await fetchJson<{ events?: NBEvent[] }>(`/api/events?spaceId=${currentSpace.id}`);
        setEvents(data.events ?? []);
      } catch (error) {
        console.error('Failed to load events:', error);
      } finally {
        setLoading(false);
      }
    };

    loadEvents();
  }, [currentSpace]);

  // Apply filters
  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      // Scope: "My events" = events I host; "Discover" = publicly discoverable
      // events; "Space" = everything in the current space.
      if (scope === 'mine') {
        if (!myNodeId || !event.hosts?.includes(myNodeId)) return false;
      } else if (scope === 'discover') {
        if (event.visibility !== 'public') return false;
      }

      // Time filter. An event with no date yet counts as upcoming — it hasn't
      // happened, it just hasn't been scheduled (created note-first from the
      // context surface). "Past" still needs a real date to be past.
      if (timeFilter === 'upcoming') {
        if (event.startAt && !isEventUpcoming(event.startAt)) return false;
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

  if (!currentSpace) {
    return (
      <div className="min-h-screen w-full py-8">
        <div className="w-full max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center gap-3 py-12">
            <p className="text-text-muted">Select a space to view its events.</p>
            <Link href="/events/discover" className="text-sm font-medium text-brand-green hover:underline">
              Or discover public events everywhere →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full">
      {/* Scope tabs pinned flush in the top-left corner — same treatment as
          the Directory's Grid / Context bar (PaneTabBar): the bar full-bleeds
          left into the sidebar seam and its bottom border runs edge to edge.
          "-top-4 -mt-4" cancels <main>'s pt-4 so it sits flush under the
          navbar (at rest and pinned); "-ml-[23px]" bleeds left to 1px shy of
          the rail edge so the sidebar's right border stays visible.
          UnderlineTabs draws its own bottom border, so the wrapper stays
          borderless. */}
      <div ref={viewBarRef} className="sticky -top-4 -mt-4 z-[45] -ml-[23px] bg-surface-1">
        {/* Keeps the page scrollbar from running up beside the pinned bar. */}
        <PaneTopScrollbarMask />
        <EventsScopeSelector scope={scope} onScopeChange={setScope} className="w-full overflow-x-auto px-1" />
      </div>

      {/* One toolbar row: search, filters, and the view at the far end */}
      <div className="flex flex-wrap items-center gap-3 px-1 pt-3 pb-1">
        <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search events…" className="w-full max-w-xs" />
        <EventsToolbar
          currentFilter={timeFilter}
          onFilterChange={setTimeFilter}
          locationFilter={locationFilter}
          onLocationFilterChange={setLocationFilter}
        />
        <EventsViewSelector currentView={currentView} onViewChange={setCurrentView} className="ml-auto" />
      </div>

      {/* View Content */}
      <div className="px-1 pt-5 pb-8">
        {currentView === 'calendar' && (
          <EventsCalendarView events={filteredEvents} onEventClick={handleEventClick} loading={loading} />
        )}

        {currentView === 'feed' && (
          <EventsFeedView
            events={filteredEvents}
            space={{ name: currentSpace.name, imageUrl: currentSpace.imageUrl }}
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
