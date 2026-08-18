'use client';

/**
 * Calendar view for events — Partiful-clean redesign.
 *
 * One calm, borderless soft-tile month grid as the single hero surface. No
 * month/week/day/agenda toggle, no 24h time grids — the only verb is CLICK A
 * DAY, which surfaces that day's events as soft cards (a sticky right panel on
 * lg+, stacked below the grid on mobile). Events in the grid collapse to up to
 * three quiet dots tinted by the event's own theme.color (else one brand-green),
 * never colored blocks.
 *
 * The signature hover is the CRM directory table's "magic move": a single
 * rAF-driven green overlay that snaps on first reveal then glides + resizes
 * between day tiles, never re-rendering React.
 */

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { formatEventTime, isEventPast, getEventStatus } from '@/lib/eventUtils';
import type { NBEvent } from '@/lib/types';
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from '@/features/shared/icons';

interface EventWithStats extends NBEvent {
  _stats?: { totalAttendees: number };
}

interface EventsCalendarViewProps {
  events: EventWithStats[];
  onEventClick?: (event: NBEvent) => void;
  loading?: boolean;
}

interface CalendarDay {
  date: Date;
  isCurrentMonth: boolean;
  events: EventWithStats[];
}

const WEEKDAYS = [
  { letter: 'S', name: 'Sunday' },
  { letter: 'M', name: 'Monday' },
  { letter: 'T', name: 'Tuesday' },
  { letter: 'W', name: 'Wednesday' },
  { letter: 'T', name: 'Thursday' },
  { letter: 'F', name: 'Friday' },
  { letter: 'S', name: 'Saturday' },
];

function dotColor(event: NBEvent): string {
  return event.theme?.color ?? 'var(--color-brand-green)';
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export default function EventsCalendarView({ events, onEventClick, loading = false }: EventsCalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => new Date());

  // ── Gliding cell highlight ("magic move") ─────────────────────────────────────
  // A single overlay that glides + resizes between day tiles as the pointer
  // moves, driven imperatively (refs + rAF) so mousemove never re-renders React.
  // It lives in the relative month-region wrapper, OUTSIDE the 7-col grid (an
  // extra grid child would break grid-cols-7).
  const monthCardRef = useRef<HTMLDivElement>(null);
  const cellOverlayRef = useRef<HTMLDivElement>(null);
  const overlayRafRef = useRef<number | null>(null);
  const pendingCellRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const placeOverlay = useCallback(() => {
    overlayRafRef.current = null;
    const overlay = cellOverlayRef.current;
    const card = monthCardRef.current;
    if (!overlay || !card) return;
    const cell = pendingCellRef.current;
    if (!cell) { overlay.style.opacity = '0'; return; }
    const cr = cell.getBoundingClientRect();
    const kr = card.getBoundingClientRect();
    // First reveal: snap into place (duration 0) so it doesn't slide in from the
    // corner; afterwards let the CSS transition glide between tiles.
    const reveal = overlay.style.opacity !== '1';
    if (reveal) overlay.style.transitionDuration = '0s';
    overlay.style.width = `${cr.width}px`;
    overlay.style.height = `${cr.height}px`;
    overlay.style.transform = `translate(${cr.left - kr.left}px, ${cr.top - kr.top}px)`;
    if (reveal) { void overlay.offsetWidth; overlay.style.transitionDuration = ''; }
    overlay.style.opacity = '1';
  }, []);

  const scheduleOverlay = useCallback((cell: HTMLElement | null) => {
    pendingCellRef.current = cell;
    if (overlayRafRef.current == null) overlayRafRef.current = requestAnimationFrame(placeOverlay);
  }, [placeOverlay]);

  // Track reflow (e.g. crossing the lg breakpoint) so the ring stays aligned.
  useEffect(() => {
    const onResize = () => scheduleOverlay(pendingCellRef.current);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (overlayRafRef.current != null) cancelAnimationFrame(overlayRafRef.current);
    };
  }, [scheduleOverlay]);

  // 6×7 grid of days for the current month (with leading/trailing days).
  const calendarDays = useMemo((): CalendarDay[] => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - startDate.getDay());

    const endDate = new Date(lastDay);
    endDate.setDate(endDate.getDate() + (6 - endDate.getDay()));

    const days: CalendarDay[] = [];
    const cursor = new Date(startDate);

    while (cursor <= endDate) {
      const dayEvents = events
        .filter(event => isSameDay(new Date(event.startAt), cursor))
        .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());

      days.push({
        date: new Date(cursor),
        isCurrentMonth: cursor.getMonth() === month,
        events: dayEvents,
      });

      cursor.setDate(cursor.getDate() + 1);
    }

    return days;
  }, [currentDate, events]);

  const selectedDayEvents = useMemo(
    () =>
      events
        .filter(event => isSameDay(new Date(event.startAt), selectedDate))
        .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()),
    [events, selectedDate],
  );

  const navigate = (direction: 'prev' | 'next') => {
    // Hide the gliding ring cleanly before the grid reflows underneath it.
    pendingCellRef.current = null;
    scheduleOverlay(null);
    setCurrentDate(prev => {
      const next = new Date(prev);
      next.setMonth(next.getMonth() + (direction === 'next' ? 1 : -1));
      return next;
    });
  };

  const goToToday = () => {
    const now = new Date();
    setCurrentDate(now);
    setSelectedDate(now);
  };

  const selectDay = (date: Date) => {
    setSelectedDate(date);
    // On mobile the panel sits below the grid — bring it into view on tap.
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
      requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  };

  const monthLabel = currentDate.toLocaleString('default', { month: 'long' });
  const yearLabel = currentDate.getFullYear();

  const selectedWeekday = selectedDate.toLocaleDateString('default', { weekday: 'long' });
  const selectedDateLabel = selectedDate.toLocaleDateString('default', { month: 'long', day: 'numeric' });

  return (
    <div className="mx-auto w-full max-w-5xl xl:max-w-6xl 2xl:max-w-7xl">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px] gap-6 lg:gap-8 items-start">
        {/* ── Month region ──────────────────────────────────────────────── */}
        {/* overflow-hidden: the gliding overlay is an absolutely-positioned
            child; clipping keeps a stale transform (e.g. after a resize with
            no mousemove to re-place it on touch) from causing page overflow. */}
        <div ref={monthCardRef} className="relative overflow-hidden">
          {/* Navigation row */}
          <div className="flex items-center justify-between mb-3 px-1">
            <h2 className="text-3xl sm:text-4xl font-normal tracking-tight font-title text-text-primary">
              {monthLabel} <span className="text-text-muted">{yearLabel}</span>
            </h2>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => navigate('prev')}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-text-muted hover:bg-surface-3 transition-colors"
                aria-label="Previous month"
              >
                <ChevronLeftIcon className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={goToToday}
                className="rounded-full px-3 h-9 text-sm font-medium text-brand-dark-green hover:bg-brand-light-bg transition-colors"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => navigate('next')}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-text-muted hover:bg-surface-3 transition-colors"
                aria-label="Next month"
              >
                <ChevronRightIcon className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Month card — borderless, shadowless; gap separates the tiles */}
          <div className="rounded-3xl bg-surface-1 p-2 sm:p-3">
            {/* Weekday header */}
            <div className="grid grid-cols-7 gap-1 px-1 pb-1">
              {WEEKDAYS.map((wd, i) => (
                <div
                  key={i}
                  aria-label={wd.name}
                  className="text-center text-[11px] font-medium uppercase tracking-wide text-text-muted"
                >
                  {wd.letter}
                </div>
              ))}
            </div>

            {/* Day grid */}
            <div
              className="grid grid-cols-7 gap-1 sm:gap-1.5"
              onMouseMove={e => scheduleOverlay((e.target as HTMLElement).closest('[data-day-cell]') as HTMLElement | null)}
              onMouseLeave={() => scheduleOverlay(null)}
            >
              {calendarDays.map((day, idx) => {
                const today = isSameDay(day.date, new Date());
                const selected = isSameDay(day.date, selectedDate);
                const extra = day.events.length - 3;

                return (
                  <button
                    key={idx}
                    type="button"
                    data-day-cell
                    aria-pressed={selected}
                    aria-label={day.date.toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric' })}
                    onClick={() => selectDay(day.date)}
                    className={`relative flex flex-col items-center justify-start rounded-2xl py-2 cursor-pointer select-none transition-colors aspect-square min-h-[52px] sm:aspect-auto sm:min-h-[88px] lg:min-h-[100px] xl:min-h-[116px] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green/50 ${
                      selected ? 'bg-brand-green/10 ring-1 ring-inset ring-brand-green/40' : ''
                    }`}
                  >
                    {/* Date number (today/selected style the wrapper) */}
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full text-sm font-medium tabular-nums leading-none ${
                        selected
                          ? 'text-brand-dark-green font-semibold'
                          : today
                          ? 'bg-brand-light-bg text-brand-dark-green font-semibold'
                          : day.isCurrentMonth
                          ? 'text-text-secondary'
                          : 'text-text-muted/40'
                      }`}
                    >
                      {day.date.getDate()}
                    </span>

                    {/* Event dots — calm, never blocks */}
                    {!loading && day.events.length > 0 && (
                      <span className="mt-1.5 flex items-center justify-center gap-1 h-1.5 pointer-events-none">
                        {day.events.slice(0, 3).map(event => (
                          <span
                            key={event.id}
                            className={`h-1.5 w-1.5 rounded-full ${isEventPast(event.endAt, event.startAt) ? 'opacity-40' : ''}`}
                            style={{ backgroundColor: dotColor(event) }}
                          />
                        ))}
                        {extra > 0 && (
                          <span className="text-[9px] font-semibold leading-none text-text-muted ml-0.5">
                            +{extra}
                          </span>
                        )}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Gliding cell highlight (positioned imperatively over the hovered tile) */}
          <div
            ref={cellOverlayRef}
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 z-10 rounded-2xl opacity-0 transition-all duration-200 will-change-transform"
            style={{
              boxShadow: 'inset 0 0 0 1.5px var(--color-brand-green)',
              backgroundColor: 'rgba(120, 216, 112, 0.07)',
              transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          />
        </div>

        {/* ── Selected-day panel ────────────────────────────────────────── */}
        <div
          ref={panelRef}
          className="rounded-3xl bg-surface-1 ring-1 ring-border-subtle/70 p-5 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-96px)] lg:overflow-y-auto"
        >
          <div className="border-b border-border-subtle pb-4 mb-4">
            <div className="text-xs font-medium uppercase tracking-wide text-brand-dark-green">
              {selectedWeekday}
            </div>
            <div className="text-2xl font-normal tracking-tight font-title text-text-primary">
              {selectedDateLabel}
            </div>
            {!loading && (
              <div className="text-sm text-text-muted mt-0.5">
                {selectedDayEvents.length === 0
                  ? 'No events'
                  : `${selectedDayEvents.length} event${selectedDayEvents.length === 1 ? '' : 's'}`}
              </div>
            )}
          </div>

          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2].map(i => (
                <div key={i} className="rounded-2xl bg-surface-2 animate-pulse h-16" />
              ))}
            </div>
          ) : selectedDayEvents.length === 0 ? (
            <div className="rounded-2xl bg-surface-2 px-6 py-10 text-center">
              <CalendarIcon className="mx-auto mb-3 h-6 w-6 text-text-muted/60" />
              <p className="text-sm text-text-muted">Nothing on this day.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {selectedDayEvents.map(event => {
                const status = getEventStatus(event.startAt, event.endAt);
                const meta = [
                  formatEventTime(event.startAt),
                  event.location?.label,
                  event._stats?.totalAttendees ? `${event._stats.totalAttendees} going` : null,
                ]
                  .filter(Boolean)
                  .join(' · ');

                return (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => onEventClick?.(event)}
                    className={`group flex w-full items-stretch gap-3 rounded-2xl bg-surface-2 p-3 text-left transition-colors hover:bg-surface-3 ${
                      status === 'past' ? 'opacity-60' : ''
                    }`}
                  >
                    <span
                      className="w-[3px] shrink-0 self-stretch rounded-full"
                      style={{ backgroundColor: dotColor(event) }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-text-primary truncate">{event.title}</div>
                      {meta && <div className="mt-0.5 text-xs text-text-muted truncate">{meta}</div>}
                      {status === 'live' && (
                        <span className="mt-1 inline-block text-[10px] font-medium text-brand-dark-green bg-brand-light-bg rounded-full px-2 py-0.5">
                          Live
                        </span>
                      )}
                    </div>
                    {event.coverImageUrl && (
                      <img
                        src={event.coverImageUrl}
                        alt=""
                        className="hidden sm:block h-12 w-12 rounded-xl object-cover shrink-0"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
