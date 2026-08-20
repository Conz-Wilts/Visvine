'use client';

/**
 * Calendar / Feed switch for the Events page. A small two-word ViewToggle that
 * sits at the right end of the toolbar row — the scope tabs own the pane-top
 * bar, so the view is a secondary choice, not a second row of chrome.
 */

import { ViewToggle } from '@/components/ui';

export type EventView = 'calendar' | 'feed';

const CalendarGlyph = (
  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);
const FeedGlyph = (
  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h10" />
  </svg>
);

interface EventsViewSelectorProps {
  currentView: EventView;
  onViewChange: (view: EventView) => void;
  className?: string;
}

export default function EventsViewSelector({ currentView, onViewChange, className }: EventsViewSelectorProps) {
  return (
    <ViewToggle
      size="sm"
      value={currentView}
      onChange={onViewChange}
      className={className}
      options={[
        { id: 'calendar', label: 'Calendar', icon: CalendarGlyph },
        { id: 'feed', label: 'Feed', icon: FeedGlyph },
      ]}
    />
  );
}
