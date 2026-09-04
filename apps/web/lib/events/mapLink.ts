/**
 * Where an event's location opens when someone taps it. Pure, shared by the
 * detail page, the public page and the calendar export.
 *
 * There is no one URL every map app honours, so this offers the two that
 * cover the phones people carry: a Google Maps search link — which the Google
 * Maps app claims on both platforms and which is a plain web page elsewhere —
 * and an Apple Maps link for the iPhone that has nothing else installed.
 * Coordinates pin the exact spot; a place id makes Google open the venue's
 * own listing rather than a search; a bare label is still a search.
 */
export interface MapLocation {
  label: string;
  address?: string;
  lat?: number;
  lon?: number;
  placeId?: string;
}

export interface MapLinks {
  google: string;
  apple: string;
}

const hasCoords = (l: MapLocation): l is MapLocation & { lat: number; lon: number } =>
  typeof l.lat === 'number' && typeof l.lon === 'number' && Number.isFinite(l.lat) && Number.isFinite(l.lon);

function queryText(l: MapLocation): string {
  const label = l.label.trim();
  const address = l.address?.trim();
  if (address && label && !address.toLowerCase().includes(label.toLowerCase())) return `${label}, ${address}`;
  return address || label;
}

export function mapLinksFor(location: MapLocation | null | undefined): MapLinks | null {
  if (!location || !location.label.trim()) return null;
  const text = queryText(location);
  const google = new URL('https://www.google.com/maps/search/');
  google.searchParams.set('api', '1');
  google.searchParams.set('query', hasCoords(location) ? `${location.lat},${location.lon}` : text);
  if (location.placeId) google.searchParams.set('query_place_id', location.placeId);

  const apple = new URL('https://maps.apple.com/');
  apple.searchParams.set('q', text);
  if (hasCoords(location)) apple.searchParams.set('ll', `${location.lat},${location.lon}`);

  return { google: google.toString(), apple: apple.toString() };
}

/** The Apple Maps link only on Apple devices — everywhere else Google Maps. */
export function preferredMapLink(links: MapLinks, userAgent: string | undefined): string {
  return userAgent && /iPhone|iPad|iPod|Macintosh/.test(userAgent) ? links.apple : links.google;
}
