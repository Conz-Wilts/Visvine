'use client';

/**
 * Leaflet map component for event locations
 * Must be dynamically imported with ssr: false
 */

import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { NBEvent } from '@/lib/types';

interface EventMapInnerProps {
  events: NBEvent[];
  selectedEventId: string | null;
  onSelectEvent: (id: string | null) => void;
}

// Custom green marker icon
function createMarkerIcon(selected: boolean) {
  return L.divIcon({
    className: '',
    html: `<div style="
      width: ${selected ? '32px' : '28px'};
      height: ${selected ? '32px' : '28px'};
      border-radius: 50%;
      background: ${selected ? '#78d870' : '#ffffff'};
      border: 3px solid #78d870;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
    ">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${selected ? '#fff' : '#78d870'}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
        <circle cx="12" cy="10" r="3"/>
      </svg>
    </div>`,
    iconSize: [selected ? 32 : 28, selected ? 32 : 28],
    iconAnchor: [selected ? 16 : 14, selected ? 32 : 28],
  });
}

// Custom cluster icon
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createClusterIcon(cluster: any) {
  const count = cluster.getChildCount();
  return L.divIcon({
    className: '',
    html: `<div style="
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: #78d870;
      color: white;
      font-weight: 700;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 8px rgba(120,216,112,0.4);
      border: 3px solid rgba(255,255,255,0.8);
    ">${count}</div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
}

// Component to fit bounds when events change
function FitBounds({ events }: { events: NBEvent[] }) {
  const map = useMap();

  useEffect(() => {
    if (events.length === 0) return;

    const bounds = L.latLngBounds(
      events.map(e => [e.location!.lat!, e.location!.lon!] as [number, number])
    );

    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
  }, [events, map]);

  return null;
}

export default function EventMapInner({ events, selectedEventId, onSelectEvent }: EventMapInnerProps) {
  const center = useMemo((): [number, number] => {
    if (events.length === 0) return [40, -95]; // default US center
    const sumLat = events.reduce((s, e) => s + (e.location?.lat || 0), 0);
    const sumLon = events.reduce((s, e) => s + (e.location?.lon || 0), 0);
    return [sumLat / events.length, sumLon / events.length];
  }, [events]);

  return (
    <MapContainer
      center={center}
      zoom={4}
      className="h-full w-full"
      style={{ height: '100%', width: '100%' }}
      zoomControl={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds events={events} />
      <MarkerClusterGroup
        iconCreateFunction={createClusterIcon}
        maxClusterRadius={50}
        spiderfyOnMaxZoom
        showCoverageOnHover={false}
      >
        {events.map(event => (
          <Marker
            key={event.id}
            position={[event.location!.lat!, event.location!.lon!]}
            icon={createMarkerIcon(selectedEventId === event.id)}
            eventHandlers={{
              click: () => onSelectEvent(selectedEventId === event.id ? null : event.id),
            }}
          />
        ))}
      </MarkerClusterGroup>
    </MapContainer>
  );
}
