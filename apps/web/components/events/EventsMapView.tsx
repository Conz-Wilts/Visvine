'use client';

/**
 * Map view for events — split layout.
 *
 * A scrollable event rail on the left (In-person / Virtual toggle) synced with a
 * large theme-aware Leaflet map on the right. Hovering or selecting a card
 * highlights its pin and vice-versa. Stacks vertically on mobile.
 */

import { useState, useMemo, type MouseEvent } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { MapPin, Video, Calendar, Loader2 } from 'lucide-react';
import { formatEventDate, formatEventTime, formatEventDateShort, isEventPast } from '@/lib/eventUtils';
import type { NBEvent } from '@/lib/types';

// Dynamic import — Leaflet requires window.
const EventMapInner = dynamic(() => import('./EventMapInner'), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center bg-surface-2">
      <div className="text-center">
        <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-brand-green" />
        <p className="text-sm text-text-muted">Loading map…</p>
      </div>
    </div>
  ),
});

interface EventsMapViewProps {
  events: NBEvent[];
}

type RailTab = 'in-person' | 'virtual';

export default function EventsMapView({ events }: EventsMapViewProps) {
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null);
  const [railTab, setRailTab] = useState<RailTab>('in-person');

  const { physicalEvents, virtualEvents } = useMemo(() => {
    const physical: NBEvent[] = [];
    const virtual: NBEvent[] = [];
    events.forEach(event => {
      if (event.location && event.location.lat != null && event.location.lon != null) {
        physical.push(event);
      } else {
        virtual.push(event);
      }
    });
    return { physicalEvents: physical, virtualEvents: virtual };
  }, [events]);

  // Keep the toggle honest: if the active tab is empty but the other has events,
  // fall back so the rail is never blank while events exist.
  const effectiveTab: RailTab =
    railTab === 'in-person' && physicalEvents.length === 0 && virtualEvents.length > 0
      ? 'virtual'
      : railTab === 'virtual' && virtualEvents.length === 0 && physicalEvents.length > 0
        ? 'in-person'
        : railTab;

  const railEvents = effectiveTab === 'in-person' ? physicalEvents : virtualEvents;
  const noEvents = events.length === 0;

  return (
    <div className="flex flex-col-reverse overflow-hidden rounded-2xl border border-border-subtle bg-surface-1 shadow-sm lg:h-[calc(100vh-430px)] lg:min-h-[480px] lg:flex-row">
      {/* ── Left rail ─────────────────────────────────────────────────── */}
      <div className="flex max-h-[55vh] w-full flex-col border-t border-border-subtle lg:max-h-none lg:w-[380px] lg:shrink-0 lg:border-r lg:border-t-0">
        {/* Header + segmented toggle */}
        <div className="shrink-0 border-b border-border-subtle px-4 py-3">
          <div
            role="tablist"
            aria-label="Event location type"
            className="inline-flex w-full rounded-xl bg-surface-2 p-0.5"
          >
            <SegTab
              active={effectiveTab === 'in-person'}
              onClick={() => setRailTab('in-person')}
              icon={<MapPin className="h-3.5 w-3.5" />}
              label="In person"
              count={physicalEvents.length}
            />
            <SegTab
              active={effectiveTab === 'virtual'}
              onClick={() => setRailTab('virtual')}
              icon={<Video className="h-3.5 w-3.5" />}
              label="Virtual"
              count={virtualEvents.length}
            />
          </div>
        </div>

        {/* Card list */}
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {railEvents.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
              <Calendar className="mb-3 h-10 w-10 text-text-muted" />
              <p className="font-semibold text-text-primary">
                {noEvents ? 'No events found' : `No ${effectiveTab === 'in-person' ? 'in-person' : 'virtual'} events`}
              </p>
              <p className="mt-1 text-sm text-text-muted">
                {noEvents ? 'Try adjusting your filters or search.' : 'Switch tabs to see other events.'}
              </p>
            </div>
          ) : (
            railEvents.map(event =>
              effectiveTab === 'in-person' ? (
                <PhysicalCard
                  key={event.id}
                  event={event}
                  selected={selectedEventId === event.id}
                  onSelect={() =>
                    setSelectedEventId(selectedEventId === event.id ? null : event.id)
                  }
                  onHover={setHoveredEventId}
                />
              ) : (
                <VirtualCard key={event.id} event={event} />
              ),
            )
          )}
        </div>
      </div>

      {/* ── Right map pane ───────────────────────────────────────────── */}
      {/* flex-1 only at lg: on mobile the column-reverse parent has no fixed
          height, so flex-1's basis:0 would collapse the pane — keep h-[52vh]. */}
      <div className="relative h-[52vh] lg:h-auto lg:flex-1">
        {physicalEvents.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center bg-surface-2 px-6">
            <div className="text-center">
              <MapPin className="mx-auto mb-4 h-14 w-14 text-text-muted" />
              <p className="text-lg font-semibold text-text-primary">No events with locations</p>
              <p className="mx-auto mt-2 max-w-xs text-sm text-text-muted">
                Add location coordinates to events to see them plotted on the map.
              </p>
            </div>
          </div>
        ) : (
          <EventMapInner
            events={physicalEvents}
            selectedEventId={selectedEventId}
            hoveredEventId={hoveredEventId}
            onSelectEvent={setSelectedEventId}
          />
        )}
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SegTab({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-[10px] px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green ${
        active
          ? 'bg-surface-1 text-text-primary shadow-sm'
          : 'text-text-muted hover:text-text-primary'
      }`}
    >
      {icon}
      {label}
      <span className={active ? 'text-brand-green' : 'text-text-muted'}>{count}</span>
    </button>
  );
}

function DateBadge({ startAt }: { startAt: string }) {
  const { month, day } = formatEventDateShort(startAt);
  return (
    <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg bg-brand-light-bg text-brand-green">
      <span className="text-[10px] font-bold leading-none tracking-wide">{month}</span>
      <span className="mt-0.5 text-lg font-bold leading-none">{day}</span>
    </div>
  );
}

function PhysicalCard({
  event,
  selected,
  onSelect,
  onHover,
}: {
  event: NBEvent;
  selected: boolean;
  onSelect: () => void;
  onHover: (id: string | null) => void;
}) {
  const past = isEventPast(event.endAt, event.startAt);
  return (
    <button
      onClick={onSelect}
      onMouseEnter={() => onHover(event.id)}
      onMouseLeave={() => onHover(null)}
      aria-pressed={selected}
      className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green ${
        selected
          ? 'border-brand-green bg-brand-light-bg shadow-sm'
          : 'border-border-subtle hover:border-brand-green hover:shadow-sm'
      } ${past ? 'opacity-60' : ''}`}
    >
      <DateBadge startAt={event.startAt} />
      <div className="min-w-0 flex-1">
        <Link
          href={`/events/${event.id}`}
          onClick={(e: MouseEvent) => e.stopPropagation()}
          className="block truncate font-semibold text-text-primary hover:text-brand-green"
        >
          {event.title}
        </Link>
        <p className="mt-0.5 text-sm text-text-muted">{formatEventTime(event.startAt)}</p>
        {event.location && (
          <p className="mt-0.5 flex items-center gap-1 truncate text-sm text-text-muted">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">{event.location.label}</span>
          </p>
        )}
      </div>
    </button>
  );
}

function VirtualCard({ event }: { event: NBEvent }) {
  const past = isEventPast(event.endAt, event.startAt);
  return (
    <Link
      href={`/events/${event.id}`}
      className={`flex w-full items-start gap-3 rounded-xl border border-border-subtle p-3 transition-all hover:border-brand-green hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green ${
        past ? 'opacity-60' : ''
      }`}
    >
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-text-muted">
        <Video className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <h4 className="truncate font-semibold text-text-primary">{event.title}</h4>
        <p className="mt-0.5 text-sm text-text-muted">
          {formatEventDate(event.startAt)} · {formatEventTime(event.startAt)}
        </p>
        <p className="mt-0.5 flex items-center gap-1 text-sm text-text-muted">
          <Video className="h-3 w-3 shrink-0" />
          Virtual
        </p>
      </div>
    </Link>
  );
}
