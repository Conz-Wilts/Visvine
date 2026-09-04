'use client';

import { useEffect, useState } from 'react';
import { mapLinksFor, preferredMapLink, type MapLocation } from '@/lib/events/mapLink';

/**
 * The map link an event's location opens, chosen for the device in hand: Apple
 * Maps on an iPhone or a Mac, Google Maps everywhere else. Google's link is
 * the server-rendered one, so the page never mismatches on hydration.
 */
export function useMapLink(location: MapLocation | null | undefined): string | null {
  const links = mapLinksFor(location);
  const [ua, setUa] = useState<string | undefined>(undefined);
  useEffect(() => { setUa(navigator.userAgent); }, []);
  return links ? preferredMapLink(links, ua) : null;
}
