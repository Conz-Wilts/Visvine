'use client';

/**
 * Calendar view for events
 * Supports month, week, day, and agenda display modes
 * Day view shows Google Calendar-style time grid
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import { formatEventTime, isEventPast } from '@/lib/eventUtils';
import type { NBEvent } from '@/lib/types';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';

interface EventsCalendarViewProps {
  events: NBEvent[];
  onEventClick?: (event: NBEvent) => void;
}

type CalendarMode = 'month' | 'week' | 'day' | 'agenda';

interface CalendarDay {
  date: Date;
  isCurrentMonth: boolean;
  events: NBEvent[];
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);

function formatHour(h: number) {
  if (h === 0) return '12 AM';
  if (h < 12) return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}

const EVENT_COLORS = [
  'bg-blue-500',
  'bg-purple-500',
  'bg-pink-500',
  'bg-indigo-500',
  'bg-teal-500',
  'bg-orange-500',
  'bg-green-500',
  'bg-yellow-500',
];

function getEventColor(event: NBEvent): string {
  const eventType = (event.metadata?.type as string) || 'event';
  const hash = eventType.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return EVENT_COLORS[hash % EVENT_COLORS.length];
}

export default function EventsCalendarView({ events, onEventClick }: EventsCalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [mode, setMode] = useState<CalendarMode>('month');
  const timeGridRef = useRef<HTMLDivElement>(null);

  // Scroll to current time on day/week view
  useEffect(() => {
    if ((mode === 'day' || mode === 'week') && timeGridRef.current) {
      const now = new Date();
      const scrollTop = (now.getHours() - 1) * 64;
      timeGridRef.current.scrollTop = Math.max(0, scrollTop);
    }
  }, [mode, currentDate]);

  // Generate calendar days for month view
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
    const currentDay = new Date(startDate);

    while (currentDay <= endDate) {
      const dayEvents = events.filter(event => {
        const eventDate = new Date(event.startAt);
        return (
          eventDate.getFullYear() === currentDay.getFullYear() &&
          eventDate.getMonth() === currentDay.getMonth() &&
          eventDate.getDate() === currentDay.getDate()
        );
      });

      days.push({
        date: new Date(currentDay),
        isCurrentMonth: currentDay.getMonth() === month,
        events: dayEvents,
      });

      currentDay.setDate(currentDay.getDate() + 1);
    }

    return days;
  }, [currentDate, events]);

  // Get days for week view (Sun–Sat)
  const weekDays = useMemo(() => {
    const weekStart = new Date(currentDate);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [currentDate]);

  // Get events for a specific day
  const getEventsForDay = (date: Date) =>
    events.filter(event => {
      const e = new Date(event.startAt);
      return (
        e.getFullYear() === date.getFullYear() &&
        e.getMonth() === date.getMonth() &&
        e.getDate() === date.getDate()
      );
    }).sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());

  // Get upcoming events for agenda view
  const agendaEvents = useMemo(() => {
    const now = new Date();
    return events
      .filter(event => new Date(event.startAt) >= now)
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
      .slice(0, 30);
  }, [events]);

  const navigate = (direction: 'prev' | 'next') => {
    const newDate = new Date(currentDate);
    if (mode === 'month') newDate.setMonth(newDate.getMonth() + (direction === 'next' ? 1 : -1));
    else if (mode === 'week') newDate.setDate(newDate.getDate() + (direction === 'next' ? 7 : -7));
    else if (mode === 'day') newDate.setDate(newDate.getDate() + (direction === 'next' ? 1 : -1));
    setCurrentDate(newDate);
  };

  const goToToday = () => setCurrentDate(new Date());

  const headerTitle = useMemo(() => {
    if (mode === 'month')
      return currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });
    if (mode === 'week') {
      const weekStart = new Date(currentDate);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      return `${weekStart.toLocaleDateString('default', { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }
    if (mode === 'day')
      return currentDate.toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    return 'Upcoming Events';
  }, [currentDate, mode]);

  const isToday = (date: Date) => {
    const now = new Date();
    return date.getDate() === now.getDate() && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  };

  // Current time line position (fraction of day) — updates every 60s
  const [currentTimeFraction, setCurrentTimeFraction] = useState(() => {
    const now = new Date();
    return (now.getHours() * 60 + now.getMinutes()) / (24 * 60);
  });

  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      setCurrentTimeFraction((now.getHours() * 60 + now.getMinutes()) / (24 * 60));
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Render a time grid column for a single day (used in both Day and Week views)
  const renderDayColumn = (date: Date, showDateHeader: boolean, columnClass = '') => {
    const dayEvents = getEventsForDay(date);
    const today = isToday(date);

    return (
      <div key={date.toISOString()} className={`relative flex flex-col ${columnClass}`}>
        {showDateHeader && (
          <div className={`sticky top-0 z-10 flex flex-col items-center py-2 border-b border-border-subtle bg-surface-1 ${today ? 'text-brand-green' : 'text-brand-grey'}`}>
            <span className="text-xs font-semibold uppercase">
              {date.toLocaleString('default', { weekday: 'short' })}
            </span>
            <span className={`text-lg font-bold mt-0.5 w-8 h-8 flex items-center justify-center rounded-full ${today ? 'bg-brand-green text-white' : ''}`}>
              {date.getDate()}
            </span>
          </div>
        )}

        {/* Hour slots */}
        <div className="relative" style={{ height: `${24 * 64}px` }}>
          {HOURS.map(h => (
            <div key={h} className="absolute w-full border-t border-border-subtle" style={{ top: `${h * 64}px`, height: '64px' }} />
          ))}

          {/* Current time red line */}
          {today && (
            <div
              className="absolute left-0 right-0 z-20 pointer-events-none"
              style={{ top: `${currentTimeFraction * 24 * 64}px` }}
            >
              <div className="relative flex items-center">
                <div className="w-2 h-2 rounded-full bg-red-500 -ml-1 flex-shrink-0" />
                <div className="flex-1 h-px bg-red-500" />
              </div>
            </div>
          )}

          {/* Events with overlap handling */}
          {(() => {
            // Calculate overlap groups
            const positioned = dayEvents.map(event => {
              const start = new Date(event.startAt);
              const end = event.endAt ? new Date(event.endAt) : new Date(start.getTime() + 60 * 60 * 1000);
              const startMinutes = start.getHours() * 60 + start.getMinutes();
              const endMinutes = startMinutes + Math.max(30, (end.getTime() - start.getTime()) / 60000);
              return { event, startMinutes, endMinutes };
            });

            // Assign columns to overlapping events
            const columns: number[] = new Array(positioned.length).fill(0);
            const groupSizes: number[] = new Array(positioned.length).fill(1);

            for (let i = 0; i < positioned.length; i++) {
              // Find all events overlapping with this one
              const group = [i];
              for (let j = 0; j < positioned.length; j++) {
                if (i === j) continue;
                if (positioned[i].startMinutes < positioned[j].endMinutes && positioned[i].endMinutes > positioned[j].startMinutes) {
                  group.push(j);
                }
              }
              const maxCol = group.length;
              // Assign this event to the first available column
              const usedCols = new Set(group.filter(g => g < i).map(g => columns[g]));
              let col = 0;
              while (usedCols.has(col)) col++;
              columns[i] = col;
              // Update group sizes for all members
              for (const g of group) groupSizes[g] = Math.max(groupSizes[g], maxCol);
            }

            return positioned.map(({ event, startMinutes, endMinutes }, idx) => {
              const topPx = (startMinutes / 60) * 64;
              const heightPx = Math.max(28, ((endMinutes - startMinutes) / 60) * 64);
              const col = columns[idx];
              const totalCols = groupSizes[idx];
              const widthPct = 100 / totalCols;
              const leftPct = col * widthPct;

              return (
                <button
                  key={event.id}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onEventClick?.(event); }}
                  className={`absolute rounded-md px-2 py-1 text-white text-xs font-medium overflow-hidden hover:opacity-90 transition-opacity z-10 text-left ${getEventColor(event)}`}
                  style={{
                    top: `${topPx}px`,
                    height: `${heightPx}px`,
                    left: `calc(${leftPct}% + 2px)`,
                    width: `calc(${widthPct}% - 4px)`,
                  }}
                  title={event.title}
                >
                  <div className="font-semibold truncate">{event.title}</div>
                  {heightPx > 40 && (
                    <div className="opacity-80 truncate">
                      {formatEventTime(event.startAt)}
                      {event.location && ` · ${event.location.label}`}
                    </div>
                  )}
                </button>
              );
            });
          })()}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-0">
      {/* Calendar Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-brand-black">{headerTitle}</h2>
          {mode !== 'agenda' && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => navigate('prev')}
                className="p-1.5 hover:bg-surface-3 rounded-lg transition-colors"
                aria-label="Previous"
              >
                <ChevronLeft className="w-4 h-4 text-brand-grey" />
              </button>
              <button
                onClick={goToToday}
                className="px-3 py-1 text-sm font-medium text-brand-green hover:bg-brand-light-bg rounded-lg transition-colors"
              >
                Today
              </button>
              <button
                onClick={() => navigate('next')}
                className="p-1.5 hover:bg-surface-3 rounded-lg transition-colors"
                aria-label="Next"
              >
                <ChevronRight className="w-4 h-4 text-brand-grey" />
              </button>
            </div>
          )}
        </div>

        {/* Mode Selector */}
        <div className="flex items-center gap-1 rounded-lg border border-border-subtle bg-surface-1 p-1">
          {(['month', 'week', 'day', 'agenda'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 text-sm font-semibold rounded-md transition-colors ${
                mode === m
                  ? 'bg-brand-green text-white'
                  : 'text-brand-grey hover:text-brand-black hover:bg-surface-2'
              }`}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Month View */}
      {mode === 'month' && (
        <div className="bg-surface-1 border border-border-subtle rounded-xl overflow-hidden">
          <div className="grid grid-cols-7 border-b border-border-subtle bg-surface-2">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="p-3 text-center text-xs font-semibold text-brand-grey uppercase">
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 divide-x divide-y divide-border-subtle">
            {calendarDays.map((day, idx) => {
              const today = isToday(day.date);
              return (
                <div
                  key={idx}
                  role="gridcell"
                  aria-label={day.date.toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric' })}
                  className={`min-h-[120px] p-2 cursor-pointer transition-colors ${
                    !day.isCurrentMonth ? 'bg-surface-2' : 'bg-surface-1'
                  } hover:bg-surface-2`}
                  onClick={() => { setCurrentDate(day.date); setMode('day'); }}
                >
                  <div className="flex items-center justify-center mb-1">
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium ${
                        today
                          ? 'bg-brand-green text-white'
                          : day.isCurrentMonth
                          ? 'text-brand-black'
                          : 'text-brand-grey'
                      }`}
                    >
                      {day.date.getDate()}
                    </span>
                  </div>

                  <div className="space-y-0.5">
                    {day.events.slice(0, 3).map(event => (
                      <button
                        key={event.id}
                        type="button"
                        onClick={e => { e.stopPropagation(); onEventClick?.(event); }}
                        className={`block w-full text-left px-1.5 py-0.5 rounded text-xs font-medium truncate transition-opacity hover:opacity-80 ${getEventColor(event)} text-white ${isEventPast(event.endAt, event.startAt) ? 'opacity-50' : ''}`}
                        title={event.title}
                      >
                        {formatEventTime(event.startAt)} {event.title}
                      </button>
                    ))}
                    {day.events.length > 3 && (
                      <div className="text-xs text-brand-grey px-1">+{day.events.length - 3} more</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Week View */}
      {mode === 'week' && (
        <div className="bg-surface-1 border border-border-subtle rounded-xl overflow-hidden">
          <div className="flex overflow-hidden">
            {/* Time gutter */}
            <div className="w-16 flex-shrink-0 border-r border-border-subtle">
              <div className="h-[57px] border-b border-border-subtle" /> {/* header spacer */}
              {HOURS.map(h => (
                <div key={h} className="h-16 flex items-start justify-end pr-2 pt-1">
                  {h > 0 && <span className="text-xs text-brand-grey">{formatHour(h)}</span>}
                </div>
              ))}
            </div>

            {/* Day columns */}
            <div
              ref={timeGridRef}
              className="flex-1 overflow-y-auto"
              style={{ maxHeight: '600px' }}
            >
              <div className="flex">
                {weekDays.map(date => renderDayColumn(date, true, 'flex-1 border-r border-border-subtle last:border-r-0'))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Day View */}
      {mode === 'day' && (
        <div className="bg-surface-1 border border-border-subtle rounded-xl overflow-hidden">
          <div className="flex overflow-hidden">
            {/* Time gutter */}
            <div className="w-16 flex-shrink-0 border-r border-border-subtle pt-[57px]">
              {HOURS.map(h => (
                <div key={h} className="h-16 flex items-start justify-end pr-2 pt-1">
                  {h > 0 && <span className="text-xs text-brand-grey">{formatHour(h)}</span>}
                </div>
              ))}
            </div>

            {/* Single day column */}
            <div
              ref={timeGridRef}
              className="flex-1 overflow-y-auto"
              style={{ maxHeight: '600px' }}
            >
              {renderDayColumn(currentDate, true, 'flex-1')}
            </div>
          </div>
        </div>
      )}

      {/* Agenda View */}
      {mode === 'agenda' && (
        <div className="bg-surface-1 border border-border-subtle rounded-xl p-6">
          {agendaEvents.length === 0 ? (
            <div className="text-center py-12">
              <CalendarIcon className="w-12 h-12 text-brand-grey mx-auto mb-4" />
              <p className="text-brand-grey">No upcoming events</p>
            </div>
          ) : (
            <div className="space-y-2">
              {agendaEvents.map(event => (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => onEventClick?.(event)}
                  className="flex w-full text-left items-start gap-4 p-4 rounded-lg border border-border-subtle hover:border-brand-green hover:shadow-sm transition-all"
                >
                  <div className="flex flex-col items-center justify-center min-w-[52px] p-2 bg-surface-2 rounded-lg">
                    <span className="text-xs font-semibold text-brand-grey uppercase">
                      {new Date(event.startAt).toLocaleString('default', { month: 'short' })}
                    </span>
                    <span className="text-xl font-bold text-brand-black">
                      {new Date(event.startAt).getDate()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${getEventColor(event)}`} />
                      <h4 className="font-semibold text-brand-black truncate">{event.title}</h4>
                    </div>
                    <p className="text-sm text-brand-grey mt-1">
                      {formatEventTime(event.startAt)}
                      {event.location && ` · ${event.location.label}`}
                    </p>
                    {event.description && (
                      <p className="text-sm text-brand-grey mt-1 line-clamp-2">{event.description}</p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
