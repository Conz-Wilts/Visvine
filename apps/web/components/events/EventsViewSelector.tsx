'use client';

/**
 * View selector for the Events tab (Calendar / Feed). Uses the shared
 * UnderlineTabs so it reads identically to the Directory's Grid / Context
 * switcher — sliding green underline, brand text colors.
 */

import { UnderlineTabs, type UnderlineTab } from '@/components/ui';

export type EventView = 'calendar' | 'feed';

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
