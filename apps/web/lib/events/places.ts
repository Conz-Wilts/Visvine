/**
 * Venue lookup for the event composer, over the Google Places API (New).
 *
 * The key stays on the server: the browser talks to /api/places, which is
 * session-gated and forwards here. Without GOOGLE_MAPS_API_KEY the composer
 * falls back to a plain venue field — a location is a label first, and the
 * place data is what makes it a map link.
 */
import type { NBEvent } from '@/lib/types';

export type EventLocation = NonNullable<NBEvent['location']>;

export interface PlaceSuggestion {
  placeId: string;
  /** The venue's own name, when the match is a business or landmark. */
  name: string;
  /** The rest of the address, for the secondary line. */
  detail: string;
}

const PLACES_BASE = 'https://places.googleapis.com/v1';
const TIMEOUT_MS = 6_000;

export function placesApiKey(): string | null {
  return process.env.GOOGLE_MAPS_API_KEY?.trim() || null;
}

async function placesRequest<T>(path: string, init: RequestInit & { fieldMask: string }): Promise<T> {
  const key = placesApiKey();
  if (!key) throw new Error('places_unavailable');
  const { fieldMask, ...rest } = init;
  const res = await fetch(`${PLACES_BASE}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': fieldMask,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`places_${res.status}`);
  return (await res.json()) as T;
}

interface AutocompleteResponse {
  suggestions?: Array<{
    placePrediction?: {
      placeId: string;
      structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
      text?: { text?: string };
    };
  }>;
}

/**
 * Venue suggestions for what the person has typed so far. `sessionToken`
 * groups the keystrokes of one search with the details call that ends it,
 * which is how Google bills a search as one lookup instead of many.
 */
export async function suggestPlaces(input: string, sessionToken?: string): Promise<PlaceSuggestion[]> {
  const q = input.trim();
  if (q.length < 3) return [];
  const data = await placesRequest<AutocompleteResponse>('/places:autocomplete', {
    method: 'POST',
    fieldMask: 'suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.text',
    body: JSON.stringify({ input: q, ...(sessionToken ? { sessionToken } : {}) }),
  });
  return (data.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => !!p?.placeId)
    .map((p) => ({
      placeId: p.placeId,
      name: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
      detail: p.structuredFormat?.secondaryText?.text ?? '',
    }))
    .filter((p) => p.name);
}

interface PlaceDetailsResponse {
  id: string;
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
}

/**
 * The picked suggestion as the location an event stores. The label is the
 * suggestion's own name, which the autocomplete already returned: asking
 * Place Details for `displayName` would move the call from the Essentials
 * SKU to the Pro one at three times the price, for a string we hold.
 */
export async function placeLocation(placeId: string, label: string, sessionToken?: string): Promise<EventLocation> {
  const qs = sessionToken ? `?sessionToken=${encodeURIComponent(sessionToken)}` : '';
  const data = await placesRequest<PlaceDetailsResponse>(`/places/${encodeURIComponent(placeId)}${qs}`, {
    method: 'GET',
    fieldMask: 'id,formattedAddress,location',
  });
  const name = label.trim();
  const address = data.formattedAddress?.trim();
  return {
    label: name || address || '',
    address: address && address !== name ? address : undefined,
    lat: data.location?.latitude,
    lon: data.location?.longitude,
    placeId: data.id || placeId,
  };
}

/**
 * A space's location is a region, never a street: a country, a state or
 * province, a county, a city. `(regions)` narrows the autocomplete to those
 * plus postal codes and suburbs, which are dropped here as too fine-grained.
 */
const REGION_TYPES = new Set([
  'country',
  'administrative_area_level_1',
  'administrative_area_level_2',
  'administrative_area_level_3',
  'locality',
  'postal_town',
  'colloquial_area',
]);

export interface RegionSuggestion {
  placeId: string;
  /** The whole name as a person writes it: "Auckland, New Zealand". */
  label: string;
  name: string;
  detail: string;
}

interface RegionAutocompleteResponse {
  suggestions?: Array<{
    placePrediction?: {
      placeId: string;
      types?: string[];
      structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
      text?: { text?: string };
    };
  }>;
}

export async function suggestRegions(input: string, sessionToken?: string): Promise<RegionSuggestion[]> {
  const q = input.trim();
  if (q.length < 2) return [];
  const data = await placesRequest<RegionAutocompleteResponse>('/places:autocomplete', {
    method: 'POST',
    fieldMask: 'suggestions.placePrediction.placeId,suggestions.placePrediction.types,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.text',
    body: JSON.stringify({ input: q, includedPrimaryTypes: ['(regions)'], ...(sessionToken ? { sessionToken } : {}) }),
  });
  return (data.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => !!p?.placeId && (p.types ?? []).some((t) => REGION_TYPES.has(t)))
    .map((p) => {
      const name = p.structuredFormat?.mainText?.text ?? p.text?.text ?? '';
      const detail = p.structuredFormat?.secondaryText?.text ?? '';
      return { placeId: p.placeId, name, detail, label: p.text?.text ?? (detail ? `${name}, ${detail}` : name) };
    })
    .filter((p) => p.name);
}

interface RegionDetailsResponse {
  addressComponents?: Array<{ shortText?: string; types?: string[] }>;
}

/** The ISO country a picked region sits in — the one fact Discover files a space under. */
export async function regionCountry(placeId: string, sessionToken?: string): Promise<string | null> {
  const qs = sessionToken ? `?sessionToken=${encodeURIComponent(sessionToken)}` : '';
  const data = await placesRequest<RegionDetailsResponse>(`/places/${encodeURIComponent(placeId)}${qs}`, {
    method: 'GET',
    fieldMask: 'addressComponents',
  });
  const code = data.addressComponents?.find((c) => c.types?.includes('country'))?.shortText?.trim().toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) ? code : null;
}
