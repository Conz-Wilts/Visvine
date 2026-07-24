'use client';

/**
 * View selector for the Events tab (Calendar / Feed / Map). Uses the shared
 * UnderlineTabs so it reads identically to the Directory's Grid / Graph / Tables
 * switcher — sliding green underline, brand text colors.
 */

import { UnderlineTabs, type UnderlineTab } from '@/components/ui';

export type EventView = 'calendar' | 'feed' | 'map';

const VIEWS: UnderlineTab<EventView>[] = [
  {
    id: 'calendar',
    label: 'Calendar',
    icon: (
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    id: 'feed',
    label: 'Feed',
    icon: (
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h10" />
      </svg>
    ),
  },
  {
    id: 'map',
    label: 'Map',
    icon: (
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
      </svg>
    ),
  },
];

interface EventsViewSelectorProps {
  currentView: EventView;
  onViewChange: (view: EventView) => void;
  /** Extra classes for the tablist (width/padding/scroll) — see the events page. */
  className?: string;
}

export default function EventsViewSelector({ currentView, onViewChange, className }: EventsViewSelectorProps) {
  return (
    <UnderlineTabs
      tabs={VIEWS}
      value={currentView}
      onChange={onViewChange}
      ariaLabel="Event views"
      idPrefix="events"
      className={className}
    />
  );
}
