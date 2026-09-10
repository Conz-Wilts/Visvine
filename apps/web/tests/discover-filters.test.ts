import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countryOptions,
  ecosystemsOf,
  filterEvents,
  filterSpaces,
  groupEventsByDay,
  sectorOptions,
  spaceCountryCode,
  type DiscoverEvent,
  type DiscoverSpace,
} from '../lib/discover/filters';

const space = (over: Partial<DiscoverSpace> & { id: string }): DiscoverSpace => ({
  name: over.id,
  tags: [],
  memberCount: 1,
  ...over,
});

const spaces: DiscoverSpace[] = [
  space({ id: 'nzvc', name: 'NZ Ventures', country: 'nz', tags: ['VC', 'Fintech'] }),
  space({ id: 'syd', name: 'Sydney Founders', location: 'Sydney, Australia', tags: ['fintech', 'Founders'] }),
  space({ id: 'room', name: 'Deal room', parentId: 'nzvc', tags: [] }),
  space({ id: 'orphan', name: 'Orphan room', parentId: 'hidden', tags: ['Climate'] }),
];

test('country comes from the column, then the location text', () => {
  assert.equal(spaceCountryCode(spaces[0]), 'NZ');
  assert.equal(spaceCountryCode(spaces[1]), 'AU');
  assert.equal(spaceCountryCode(spaces[2]), null);
});

test('options count and fold case', () => {
  assert.deepEqual(countryOptions(['NZ', 'AU', 'NZ', null]), [
    { value: 'NZ', label: 'New Zealand', count: 2 },
    { value: 'AU', label: 'Australia', count: 1 },
  ]);
  assert.deepEqual(sectorOptions(spaces).map((o) => [o.value, o.count]), [
    ['fintech', 2], ['climate', 1], ['founders', 1], ['vc', 1],
  ]);
});

test('spaces filter by search, country and sector together', () => {
  assert.deepEqual(filterSpaces(spaces, { sectors: new Set(['fintech']) }).map((s) => s.id), ['nzvc', 'syd']);
  assert.deepEqual(filterSpaces(spaces, { sectors: new Set(['fintech']), countries: new Set(['AU']) }).map((s) => s.id), ['syd']);
  assert.deepEqual(filterSpaces(spaces, { search: 'climate' }).map((s) => s.id), ['orphan']);
  assert.equal(filterSpaces(spaces, {}).length, 4);
});

test('an ecosystem is a visible parent with its sub-spaces; an orphan room is none', () => {
  const eco = ecosystemsOf(spaces);
  assert.equal(eco.length, 1);
  assert.equal(eco[0].parent.id, 'nzvc');
  assert.deepEqual(eco[0].children.map((c) => c.id), ['room']);
});

const now = new Date(2026, 8, 10, 9, 0, 0); // Thu 10 Sep 2026, local
const at = (daysFromNow: number, hour = 18) => {
  const d = new Date(now);
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};
const event = (over: Partial<DiscoverEvent> & { id: string; startAt: string }): DiscoverEvent => ({
  slug: over.id,
  title: over.id,
  description: null,
  endAt: null,
  locationLabel: null,
  eventType: 'virtual',
  coverImageUrl: null,
  spaceId: null,
  spaceName: null,
  spaceImageUrl: null,
  country: null,
  ...over,
});
const events: DiscoverEvent[] = [
  event({ id: 'later', startAt: at(20), eventType: 'in-person', country: 'NZ', locationLabel: 'Wellington' }),
  event({ id: 'tonight', startAt: at(0, 19), country: 'AU' }),
  event({ id: 'tomorrow', startAt: at(1) }),
  event({ id: 'nextweek', startAt: at(6, 8), eventType: 'in-person', country: 'NZ' }),
];

test('events filter by window, format and country, and come back in time order', () => {
  assert.deepEqual(filterEvents(events, { now }).map((e) => e.id), ['tonight', 'tomorrow', 'nextweek', 'later']);
  assert.deepEqual(filterEvents(events, { now, when: 'today' }).map((e) => e.id), ['tonight']);
  assert.deepEqual(filterEvents(events, { now, when: 'week' }).map((e) => e.id), ['tonight', 'tomorrow', 'nextweek']);
  assert.deepEqual(filterEvents(events, { now, format: 'in-person' }).map((e) => e.id), ['nextweek', 'later']);
  assert.deepEqual(filterEvents(events, { now, countries: new Set(['AU']) }).map((e) => e.id), ['tonight']);
  assert.deepEqual(filterEvents(events, { now, search: 'welling' }).map((e) => e.id), ['later']);
});

test('the board groups by local day and names the near ones', () => {
  const days = groupEventsByDay(filterEvents(events, { now }), now);
  assert.deepEqual(days.map((d) => d.label).slice(0, 2), ['Today', 'Tomorrow']);
  assert.equal(days.length, 4);
  assert.equal(days[2].label, 'Wed, Sep 16');
});
