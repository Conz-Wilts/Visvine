// The profile-section kind table: the one place that says what shape a member's
// own section can hold, which fields that shape draws, and how its rows order.
// These are the rules the routes and the editor both read it for.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SECTION_KINDS,
  MAX_SECTIONS,
  MAX_ENTRIES,
  MAX_TITLE,
  applyOrder,
  cleanTitle,
  fieldsFor,
  hasBody,
  isSectionKind,
  kindOf,
  normalizeEntry,
  sortEntries,
} from '../lib/profile/shared/sections';

test('the table names each kind once, and each kind names its fields once', () => {
  const kinds = SECTION_KINDS.map((row) => row.kind);
  assert.equal(new Set(kinds).size, kinds.length);
  for (const row of SECTION_KINDS) {
    assert.equal(new Set(row.fields).size, row.fields.length, `${row.kind} repeats a field`);
    assert.ok(row.label.trim(), `${row.kind} has no label`);
  }
});

test('exactly one kind holds prose, and it holds no rows', () => {
  const withBody = SECTION_KINDS.filter((row) => row.body);
  assert.deepEqual(withBody.map((row) => row.kind), ['text']);
  assert.deepEqual(withBody[0].fields, []);
  assert.ok(hasBody('text'));
  assert.ok(!hasBody('timeline'));
});

test('a kind is recognised, and an unknown one reads as the plainest shape', () => {
  assert.ok(isSectionKind('links'));
  assert.ok(!isSectionKind('gallery'));
  assert.ok(!isSectionKind(7));
  assert.equal(kindOf('gallery').kind, 'list');
});

test('a row keeps what its kind draws and loses what it does not', () => {
  const full = {
    title: 'Auckland', subtitle: 'BSc', description: 'notes',
    url: 'https://example.com', startYear: '2021', endYear: '2024',
    imageUrl: '/i.png', spaceId: 'visvine',
  };

  const timeline = normalizeEntry('timeline', full);
  assert.equal(timeline.subtitle, 'BSc');
  assert.equal(timeline.startYear, '2021');
  assert.equal(timeline.url, null, 'a timeline draws no URL');

  const links = normalizeEntry('links', full);
  assert.equal(links.url, 'https://example.com');
  assert.equal(links.description, null);
  assert.equal(links.startYear, null);

  // The two every kind carries survive both.
  for (const entry of [timeline, links]) {
    assert.equal(entry.spaceId, 'visvine');
    assert.equal(entry.imageUrl, '/i.png');
  }
});

test('normalizing touches only the fields it was given', () => {
  assert.deepEqual(normalizeEntry('list', { title: 'One' }), { title: 'One' });
  assert.deepEqual(normalizeEntry('list', { url: 'https://x.test' }), { url: null });
});

test('rows follow the arrangement, and a timeline breaks a tie by the later year', () => {
  const rows = [
    { id: 'a', position: 1, startYear: '2019', endYear: null },
    { id: 'b', position: 0, startYear: '2020', endYear: '2021' },
    { id: 'c', position: 0, startYear: '2022', endYear: '2024' },
  ];
  assert.deepEqual(sortEntries('timeline', rows).map((r) => r.id), ['c', 'b', 'a']);
  // Every other kind is the member's arrangement alone, stably.
  assert.deepEqual(sortEntries('list', rows).map((r) => r.id), ['b', 'c', 'a']);
});

test('a reorder keeps what it did not name and ignores what is not there', () => {
  assert.deepEqual(applyOrder(['c', 'a'], ['a', 'b', 'c']), ['c', 'a', 'b']);
  assert.deepEqual(applyOrder(['zzz'], ['a', 'b']), ['a', 'b']);
  assert.deepEqual(applyOrder([], ['a', 'b']), ['a', 'b']);
});

test('a title is trimmed, capped and never empty', () => {
  assert.equal(cleanTitle('  Education  '), 'Education');
  assert.equal(cleanTitle('   '), 'Section');
  assert.equal(cleanTitle('x'.repeat(MAX_TITLE + 20)).length, MAX_TITLE);
});

test('the caps are real numbers', () => {
  for (const cap of [MAX_SECTIONS, MAX_ENTRIES, MAX_TITLE]) {
    assert.ok(Number.isInteger(cap) && cap > 0);
  }
  assert.ok(MAX_ENTRIES > MAX_SECTIONS);
});

test('a kind that draws a field also asks for it, so the editor can render one list', () => {
  for (const row of SECTION_KINDS) {
    assert.deepEqual(fieldsFor(row.kind), row.fields);
  }
});
