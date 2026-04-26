'use client';

import { useState, useEffect, useRef } from 'react';
import type { NBEvent, NBAttendee } from '@/lib/types';

export interface EventAttendeeWithProfile extends NBAttendee {
  name?: string;
  image_url?: string;
}

export interface EventStats {
  total: number;
  registered: number;
  waitlisted: number;
  invited: number;
  checkedIn: number;
  cancelled: number;
  noShow: number;
}

export interface EventDetailsData {
  event: NBEvent;
  stats: EventStats;
  attendees: EventAttendeeWithProfile[];
}

const cache = new Map<string, { data: EventDetailsData; timestamp: number }>();
const CACHE_TTL = 60_000;
const inFlight = new Map<string, Promise<EventDetailsData>>();

function fetchEventDetails(eventId: string, communityId: string): Promise<EventDetailsData> {
  const key = `${communityId}:${eventId}`;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = fetch(
    `/api/events/${encodeURIComponent(eventId)}?communityId=${encodeURIComponent(communityId)}&includeAttendees=true`
  )
    .then((res) => {
      if (!res.ok) throw new Error('Event not found');
      return res.json();
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, promise);
  return promise;
}

export function useEventDetails(eventId: string | null, communityId: string | null) {
  const key = eventId && communityId ? `${communityId}:${eventId}` : null;

  const [data, setData] = useState<EventDetailsData | null>(() => {
    if (!key) return null;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.data;
    return null;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef(key);

  useEffect(() => {
    keyRef.current = key;
    if (!key || !eventId || !communityId) {
      setData(null);
      return;
    }

    const cached = cache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      setData(cached.data);
      return;
    }

    setLoading(true);
    setError(null);

    fetchEventDetails(eventId, communityId)
      .then((json) => {
        if (keyRef.current !== key) return;
        cache.set(key, { data: json, timestamp: Date.now() });
        setData(json);
        setLoading(false);
      })
      .catch((err) => {
        if (keyRef.current !== key) return;
        setError(err.message);
        setLoading(false);
      });
  }, [key, eventId, communityId]);

  return { data, loading, error };
}
