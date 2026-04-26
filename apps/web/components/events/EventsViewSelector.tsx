'use client';

/**
 * View selector for Events tab
 * Matches Directory's SearchAndFilters styling — grey border, muted inactive text, green active pill
 */

import { useEffect, useRef, useState } from 'react';

export type EventView = 'calendar' | 'feed' | 'map';

interface EventsViewSelectorProps {
  currentView: EventView;
  onViewChange: (view: EventView) => void;
}

const VIEWS: { id: EventView; label: string; icon: React.ReactNode }[] = [
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

function measureBtn(btn: HTMLButtonElement, container: HTMLDivElement) {
  const b = btn.getBoundingClientRect();
  const c = container.getBoundingClientRect();
  return { left: b.left - c.left, width: b.width };
}

export default function EventsViewSelector({ currentView, onViewChange }: EventsViewSelectorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pillStyle, setPillStyle] = useState<{ left: number; width: number } | null>(null);
  const animatedRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    const activeIndex = VIEWS.findIndex(v => v.id === currentView);
    const btn = buttonRefs.current[activeIndex];
    if (!container || !btn) return;
    setPillStyle(measureBtn(btn, container));
    requestAnimationFrame(() => { animatedRef.current = true; });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!animatedRef.current) return;
    const container = containerRef.current;
    const activeIndex = VIEWS.findIndex(v => v.id === currentView);
    const btn = buttonRefs.current[activeIndex];
    if (!container || !btn) return;
    setPillStyle(measureBtn(btn, container));
  }, [currentView]);

  return (
    <div
      ref={containerRef}
      className="relative flex items-center gap-1 rounded-full border border-border-default bg-surface-1 p-1 shadow-sm"
    >
      {pillStyle && (
        <span
          className="absolute top-1 bottom-1 rounded-full bg-brand-green shadow-sm"
          style={{
            left: pillStyle.left,
            width: pillStyle.width,
            transition: 'left 220ms cubic-bezier(0.4,0,0.2,1), width 220ms cubic-bezier(0.4,0,0.2,1)',
          }}
        />
      )}

      {VIEWS.map(({ id, label, icon }, i) => (
        <button
          key={id}
          ref={el => { buttonRefs.current[i] = el; }}
          onClick={() => onViewChange(id)}
          className={`relative z-10 flex h-10 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors duration-200 ${
            currentView === id ? 'text-white' : 'text-text-muted hover:text-text-secondary'
          }`}
          aria-label={`${label} view`}
        >
          {icon}
          {label}
        </button>
      ))}
    </div>
  );
}
