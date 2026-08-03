'use client';

/**
 * Leaflet map for event locations.
 * Must be dynamically imported with ssr: false (Leaflet needs `window`).
 *
 * Each marker is a compact event card (date badge + title + time). Selecting a
 * marker anchors a fuller event card directly above the pin (a React overlay
 * portalled into the map container so it tracks pan/zoom). Colors follow the
 * theme accent via the --color-brand-green CSS var, over a theme-aware CARTO
 * basemap (Positron in light, Dark Matter in dark).
 */

import { useEffect, useMemo, useReducer, useRef } from 'react';
import { createPortal } from 'react-dom';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import Link from 'next/link';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, ArrowRight, X } from 'lucide-react';
import { formatEventDate, formatEventTime, formatEventDateShort } from '@/lib/eventUtils';
import type { NBEvent } from '@/lib/types';

interface EventMapInnerProps {
  events: NBEvent[];
  selectedEventId: string | null;
  hoveredEventId: string | null;
  onSelectEvent: (id: string | null) => void;
}

const ACCENT = 'var(--color-brand-green, #78d870)';

// CARTO basemap (keyless, free for reasonable use, OSM-derived).
const TILE_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png';
const PILL_BG = '#ffffff';

const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

const CARD_W = 190;
const CARD_H = 46;
const BASE_TAIL = 7;
// Vertical spacing between stacked (de-collided) cards: card height + a gap.
const SLOT = CARD_H + 16;

type PinState = 'default' | 'hovered' | 'selected';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

// A mini event-card marker: a date badge next to the (truncated) title + time.
// `offsetY` lifts the card above its coordinate (to de-collide overlapping
// events); the connector below always runs down to the true location. Colors
// reference the accent CSS var so pins recolor with the active theme.
function createMarkerIcon(
  event: NBEvent,
  state: PinState,
  offsetY: number,
): L.DivIcon {
  const { month, day } = formatEventDateShort(event.startAt);
  const selected = state === 'selected';
  const hovered = state === 'hovered';

  const pillBg = PILL_BG;
  const borderColor = selected ? ACCENT : 'var(--color-border-subtle, #e5e7eb)';
  const borderWidth = selected ? 2 : 1;
  const scale = selected ? 1.04 : hovered ? 1.05 : 1;
  const shadow =
    selected || hovered ? '0 8px 20px rgba(0,0,0,0.28)' : '0 3px 10px rgba(0,0,0,0.18)';

  const leaderH = BASE_TAIL + offsetY;
  // A stacked card (offsetY > 0) gets a thin connector line + a dot on the
  // exact spot; a lone card keeps the compact triangle tail.
  const connector =
    offsetY > 0
      ? `<div style="position:relative;width:2px;height:${leaderH}px;margin-top:-1px;background:${ACCENT};">
           <div style="position:absolute;left:50%;bottom:-3px;transform:translateX(-50%);width:9px;height:9px;border-radius:50%;background:${ACCENT};box-shadow:0 0 0 2px ${pillBg},0 2px 4px rgba(0,0,0,0.25);"></div>
         </div>`
      : `<div style="width:0;height:0;margin-top:-1px;border-left:7px solid transparent;border-right:7px solid transparent;border-top:${BASE_TAIL}px solid ${pillBg};filter:drop-shadow(0 2px 1px rgba(0,0,0,0.12));"></div>`;

  return L.divIcon({
    className: '',
    html: `<div style="
      display:flex;flex-direction:column;align-items:center;
      transform:scale(${scale});transform-origin:bottom center;
      transition:transform 0.12s ease;
    ">
      <div style="
        width:${CARD_W}px;box-sizing:border-box;
        display:flex;align-items:center;gap:8px;padding:6px 10px 6px 6px;
        background:${pillBg};border:${borderWidth}px solid ${borderColor};
        border-radius:12px;box-shadow:${shadow};
        font-family:inherit;
      ">
        <div style="
          width:34px;height:34px;flex-shrink:0;border-radius:8px;
          background:var(--color-brand-light-bg, #eaf9ec);color:${ACCENT};
          display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1;
        ">
          <span style="font-size:8px;font-weight:700;letter-spacing:0.05em;">${month}</span>
          <span style="font-size:15px;font-weight:700;margin-top:1px;">${day}</span>
        </div>
        <div style="min-width:0;flex:1;text-align:left;">
          <div style="
            font-size:12.5px;font-weight:700;color:var(--color-text-primary, #111827);
            white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
          ">${escapeHtml(event.title)}</div>
          <div style="
            font-size:11px;font-weight:500;color:var(--color-text-muted, #6b7280);
            white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px;
          ">${escapeHtml(formatEventTime(event.startAt))}</div>
        </div>
      </div>
      ${connector}
    </div>`,
    iconSize: [CARD_W, CARD_H + leaderH],
    iconAnchor: [CARD_W / 2, CARD_H + leaderH],
  });
}

// Fit the viewport to all event coordinates whenever the set changes.
function FitBounds({ events }: { events: NBEvent[] }) {
  const map = useMap();

  useEffect(() => {
    if (events.length === 0) return;
    const bounds = L.latLngBounds(
      events.map(e => [e.location!.lat!, e.location!.lon!] as [number, number]),
    );
    map.fitBounds(bounds, { padding: [70, 70], maxZoom: 13 });
  }, [events, map]);

  return null;
}

// Assign each event a vertical offset so cards that would overlap at the current
// zoom fan out into a readable vertical stack instead of hiding one another.
// Events far enough apart get offset 0 (compact triangle tail). The selected
// event is pinned to the bottom of its stack (offset 0) so its detail card can
// anchor cleanly on its true location.
function computeOffsets(
  events: NBEvent[],
  map: L.Map,
  selectedId: string | null,
): Record<string, number> {
  const n = events.length;
  const pts = events.map(e =>
    map.latLngToContainerPoint([e.location!.lat!, e.location!.lon!]),
  );

  // Union nearby markers (whose cards would overlap) into collision groups.
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (
        Math.abs(pts[i].x - pts[j].x) <= CARD_W * 0.55 &&
        Math.abs(pts[i].y - pts[j].y) <= CARD_H + 2
      ) {
        parent[find(i)] = find(j);
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    (groups.get(r) ?? groups.set(r, []).get(r)!).push(i);
  }

  const offsets: Record<string, number> = {};
  for (const idxs of groups.values()) {
    if (idxs.length === 1) {
      offsets[events[idxs[0]].id] = 0;
      continue;
    }
    // Selected first (bottom of the stack), then stable order by id.
    const ordered = [...idxs].sort((a, b) => {
      const aSel = events[a].id === selectedId ? 0 : 1;
      const bSel = events[b].id === selectedId ? 0 : 1;
      if (aSel !== bSel) return aSel - bSel;
      return events[a].id < events[b].id ? -1 : 1;
    });
    ordered.forEach((idx, k) => {
      offsets[events[idx].id] = k * SLOT;
    });
  }
  return offsets;
}

// Renders the event-card markers, recomputing de-collision offsets whenever the
// zoom (and therefore pixel spacing) changes.
function EventMarkers({
  events,
  selectedEventId,
  hoveredEventId,
  onSelectEvent,
}: EventMapInnerProps) {
  const map = useMap();
  const [tick, setTick] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    map.on('zoomend resize', setTick);
    return () => {
      map.off('zoomend resize', setTick);
    };
  }, [map]);

  const offsets = useMemo(
    () => computeOffsets(events, map, selectedEventId),
    // tick forces a recompute after zoom/resize changes pixel spacing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, map, selectedEventId, tick],
  );

  return (
    <>
      {events.map(event => {
        const state: PinState =
          selectedEventId === event.id
            ? 'selected'
            : hoveredEventId === event.id
              ? 'hovered'
              : 'default';
        return (
          <Marker
            key={event.id}
            position={[event.location!.lat!, event.location!.lon!]}
            icon={createMarkerIcon(event, state, offsets[event.id] ?? 0)}
            zIndexOffset={state === 'selected' ? 1000 : state === 'hovered' ? 500 : 0}
            eventHandlers={{
              click: () => onSelectEvent(selectedEventId === event.id ? null : event.id),
            }}
          />
        );
      })}
    </>
  );
}

// The detail card anchored above the selected marker. Portalled into the map
// container and repositioned on every pan/zoom so it stays glued to the pin.
function SelectedCardOverlay({
  event,
  onClose,
}: {
  event: NBEvent;
  onClose: () => void;
}) {
  const map = useMap();
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const cardRef = useRef<HTMLDivElement>(null);

  // Keep the card position in sync with the map viewport.
  useEffect(() => {
    map.on('move zoom viewreset resize zoomend moveend', bump);
    return () => {
      map.off('move zoom viewreset resize zoomend moveend', bump);
    };
  }, [map]);

  // Nudge the selected pin into view without a jarring recenter. The card sits
  // ~210px above the pin, so reserve extra space at the top so it never clips.
  useEffect(() => {
    map.panInside(L.latLng(event.location!.lat!, event.location!.lon!), {
      paddingTopLeft: [40, 230],
      paddingBottomRight: [40, 50],
    });
  }, [map, event]);

  // Let clicks/scrolls on the card not fall through to the map.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
  });

  const container = map.getContainer();
  if (getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
  }

  const pt = map.latLngToContainerPoint([event.location!.lat!, event.location!.lon!]);
  const { month, day } = formatEventDateShort(event.startAt);

  return createPortal(
    <div
      ref={cardRef}
      style={{
        position: 'absolute',
        left: pt.x,
        top: pt.y,
        // Sit above the pin (pin is ~53px tall from its tip).
        transform: 'translate(-50%, calc(-100% - 58px))',
        zIndex: 1200,
        width: 300,
        maxWidth: 'calc(100% - 24px)',
        pointerEvents: 'auto',
      }}
    >
      <div className="relative overflow-hidden rounded-xl border border-border-subtle bg-surface-1 shadow-xl">
        <div className="flex items-stretch gap-3 p-3">
          {event.coverImageUrl ? (
            <img
              src={event.coverImageUrl}
              alt=""
              className="h-16 w-16 shrink-0 rounded-lg object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-lg bg-brand-light-bg text-brand-green">
              <span className="text-xs font-bold leading-none tracking-wide">{month}</span>
              <span className="mt-0.5 text-2xl font-bold leading-none">{day}</span>
            </div>
          )}
          <div className="min-w-0 flex-1 pr-4">
            <Link
              href={`/events/${event.id}`}
              className="block truncate font-semibold text-text-primary hover:text-brand-green"
            >
              {event.title}
            </Link>
            <p className="mt-0.5 text-sm text-text-muted">
              {formatEventDate(event.startAt)} · {formatEventTime(event.startAt)}
            </p>
            {event.location && (
              <p className="mt-0.5 flex items-center gap-1 truncate text-sm text-text-muted">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{event.location.label}</span>
              </p>
            )}
            <Link
              href={`/events/${event.id}`}
              className="mt-1.5 inline-flex items-center gap-1 text-sm font-medium text-brand-green hover:underline"
            >
              View event <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <button
            onClick={onClose}
            className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-text-muted hover:bg-surface-2 hover:text-text-primary"
            aria-label="Close preview"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {/* Tail pointing down to the pin */}
        <div
          className="absolute left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-border-subtle bg-surface-1"
          style={{ bottom: -6 }}
        />
      </div>
    </div>,
    container,
  );
}

export default function EventMapInner({
  events,
  selectedEventId,
  hoveredEventId,
  onSelectEvent,
}: EventMapInnerProps) {
  const center = useMemo((): [number, number] => {
    if (events.length === 0) return [40, -95]; // default US center
    const sumLat = events.reduce((s, e) => s + (e.location?.lat || 0), 0);
    const sumLon = events.reduce((s, e) => s + (e.location?.lon || 0), 0);
    return [sumLat / events.length, sumLon / events.length];
  }, [events]);

  const selectedEvent = events.find(e => e.id === selectedEventId);

  return (
    <MapContainer
      center={center}
      zoom={4}
      className="h-full w-full"
      style={{ height: '100%', width: '100%', background: '#eaeaea' }}
      zoomControl
    >
      <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} />
      <FitBounds events={events} />
      {/* Every event renders as its own card marker (no clustering) so the map
          reads consistently — no mix of full cards and numbered bundles.
          Overlapping cards fan out vertically via computeOffsets. */}
      <EventMarkers
        events={events}
        selectedEventId={selectedEventId}
        hoveredEventId={hoveredEventId}
        onSelectEvent={onSelectEvent}
      />
      {selectedEvent && (
        <SelectedCardOverlay event={selectedEvent} onClose={() => onSelectEvent(null)} />
      )}
    </MapContainer>
  );
}
