// The Discover page's pure half: what a stranger to a space can be shown, and
// how it is narrowed. Every function here is deterministic over plain data so
// the page's filters are testable without a browser or a database.
//
// Three surfaces share it: Spaces (a filterable grid), Ecosystems (top-level
// spaces with the sub-spaces that flow up from them) and the event board
// (every public upcoming event, grouped by day). Countries are ISO codes so
// the same filter serves a space's `country` and an event's host space.

import { getCountry, matchCountryInLocation } from '@/lib/countries';

export interface DiscoverSpace {
  id: string;
  name: string;
  description?: string;
  country?: string;
  location?: string;
  tags: string[];
  memberCount: number;
  imageUrl?: string;
  parentId?: string | null;
  createdAt?: string;
}

export interface DiscoverEvent {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  locationLabel: string | null;
  /** `in-person` when it has a place, `virtual` otherwise. */
  eventType: 'in-person' | 'virtual';
  coverImageUrl: string | null;
  spaceId: string | null;
  spaceName: string | null;
  spaceImageUrl: string | null;
  /** The host space's ISO country — the event board's "where". */
  country: string | null;
}

export interface CountOption {
  value: string;
  label: string;
  count: number;
}

/** A space's country as an ISO code: the column first, then the location text. */
export function spaceCountryCode(space: Pick<DiscoverSpace, 'country' | 'location'>): string | null {
  const code = space.country?.trim().toUpperCase();
  if (code && getCountry(code)) return code;
  return matchCountryInLocation(space.location)?.code ?? null;
}

/** The countries present, most-populated first, labelled by name. */
export function countryOptions(codes: Array<string | null>): CountOption[] {
  const counts = new Map<string, number>();
  for (const code of codes) {
    if (!code) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: getCountry(value)?.name ?? value, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * The sectors a set of spaces declare — their tags, folded case-insensitively
 * so "Fintech" and "fintech" are one sector — busiest first.
 */
export function sectorOptions(spaces: readonly Pick<DiscoverSpace, 'tags'>[]): CountOption[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const space of spaces) {
    const seen = new Set<string>();
    for (const tag of space.tags ?? []) {
      const key = tag.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const hit = counts.get(key);
      if (hit) hit.count += 1;
      else counts.set(key, { label: tag.trim(), count: 1 });
    }
  }
  return [...counts.entries()]
    .map(([value, { label, count }]) => ({ value, label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export interface SpaceFilter {
  search?: string;
  countries?: ReadonlySet<string>;
  sectors?: ReadonlySet<string>;
}

function matchesSearch(text: Array<string | null | undefined>, q: string): boolean {
  if (!q) return true;
  return text.some((t) => (t ?? '').toLowerCase().includes(q));
}

export function filterSpaces<T extends DiscoverSpace>(spaces: readonly T[], filter: SpaceFilter): T[] {
  const q = (filter.search ?? '').trim().toLowerCase();
  const countries = filter.countries && filter.countries.size > 0 ? filter.countries : null;
  const sectors = filter.sectors && filter.sectors.size > 0 ? filter.sectors : null;
  return spaces.filter((space) => {
    if (!matchesSearch([space.name, space.description, space.location, ...(space.tags ?? [])], q)) return false;
    if (countries) {
      const code = spaceCountryCode(space);
      if (!code || !countries.has(code)) return false;
    }
    if (sectors) {
      const tags = new Set((space.tags ?? []).map((t) => t.trim().toLowerCase()));
      let hit = false;
      for (const s of sectors) if (tags.has(s)) { hit = true; break; }
      if (!hit) return false;
    }
    return true;
  });
}

export interface Ecosystem<T extends DiscoverSpace> {
  parent: T;
  children: T[];
}

/**
 * An ecosystem is a top-level space with sub-spaces the viewer can see. A
 * sub-space whose parent is NOT in the list (a public room of a private space)
 * is not an ecosystem — it is listed on its own in Spaces.
 */
export function ecosystemsOf<T extends DiscoverSpace>(spaces: readonly T[]): Ecosystem<T>[] {
  const byParent = new Map<string, T[]>();
  for (const space of spaces) {
    if (!space.parentId) continue;
    const list = byParent.get(space.parentId) ?? [];
    list.push(space);
    byParent.set(space.parentId, list);
  }
  return spaces
    .filter((s) => !s.parentId && byParent.has(s.id))
    .map((parent) => ({
      parent,
      children: [...(byParent.get(parent.id) ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.children.length - a.children.length || a.parent.name.localeCompare(b.parent.name));
}

export type EventWhen = 'all' | 'today' | 'week' | 'month';
export type EventFormat = 'all' | 'in-person' | 'virtual';

export interface EventFilter {
  search?: string;
  when?: EventWhen;
  format?: EventFormat;
  countries?: ReadonlySet<string>;
  /** The instant "today" is measured from; defaults to now. */
  now?: Date;
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

/** The exclusive end of a "when" window, or null for no bound. */
function whenWindowEnd(when: EventWhen, now: Date): Date | null {
  const today = startOfDay(now);
  switch (when) {
    case 'today': return addDays(today, 1);
    case 'week': return addDays(today, 7);
    case 'month': return addDays(today, 30);
    default: return null;
  }
}

export function filterEvents(events: readonly DiscoverEvent[], filter: EventFilter): DiscoverEvent[] {
  const q = (filter.search ?? '').trim().toLowerCase();
  const now = filter.now ?? new Date();
  const end = whenWindowEnd(filter.when ?? 'all', now);
  const countries = filter.countries && filter.countries.size > 0 ? filter.countries : null;
  const format = filter.format ?? 'all';
  return events
    .filter((e) => {
      if (!matchesSearch([e.title, e.description, e.locationLabel, e.spaceName], q)) return false;
      if (format !== 'all' && e.eventType !== format) return false;
      if (countries && (!e.country || !countries.has(e.country))) return false;
      if (end) {
        const start = new Date(e.startAt);
        if (Number.isNaN(start.getTime()) || start >= end) return false;
      }
      return true;
    })
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
}

export interface EventDay {
  /** YYYY-MM-DD in local time — the group key. */
  key: string;
  /** "Today", "Tomorrow", or a weekday and date. */
  label: string;
  events: DiscoverEvent[];
}

const DAY_MS = 86400000;

/** Events folded by local calendar day, in order, labelled the way a person says it. */
export function groupEventsByDay(events: readonly DiscoverEvent[], now: Date = new Date()): EventDay[] {
  const today = startOfDay(now);
  const groups = new Map<string, EventDay>();
  for (const event of events) {
    const start = new Date(event.startAt);
    if (Number.isNaN(start.getTime())) continue;
    const day = startOfDay(start);
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    let group = groups.get(key);
    if (!group) {
      const diff = Math.round((day.getTime() - today.getTime()) / DAY_MS);
      const label =
        diff === 0 ? 'Today'
        : diff === 1 ? 'Tomorrow'
        : day.toLocaleDateString('en-US', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            ...(day.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
          });
      group = { key, label, events: [] };
      groups.set(key, group);
    }
    group.events.push(event);
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}
