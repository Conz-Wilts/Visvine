import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickSamePerson } from '../lib/directory/shared/samePerson';

const hq = { id: 'hq', name: 'Visvine HQ', parent_id: null };
const eng = { id: 'eng', name: 'Engineering', parent_id: 'hq' };
const mkt = { id: 'mkt', name: 'Marketing', parent_id: 'hq' };
const candidates = [
  { id: 'person:dev-admin', spaceId: 'hq', space: hq },
  { id: 'person:dev-admin-4', spaceId: 'mkt', space: mkt },
  { id: 'person:dev-admin-3', spaceId: 'eng', space: eng },
];

test('names only the records in spaces the viewer belongs to, never the one being read', () => {
  const out = pickSamePerson({ id: 'person:dev-admin', spaceId: 'hq' }, candidates, new Set(['hq', 'eng']));
  assert.deepEqual(out, [{ node_id: 'person:dev-admin-3', space: eng }]);
});

test('house first, then rooms by name', () => {
  const out = pickSamePerson({ id: 'person:dev-admin-3', spaceId: 'eng' }, candidates, new Set(['hq', 'eng', 'mkt']));
  assert.deepEqual(out.map((r) => r.space.id), ['hq', 'mkt']);
});

test('a viewer in none of the other spaces sees nothing', () => {
  assert.deepEqual(pickSamePerson({ id: 'person:dev-admin', spaceId: 'hq' }, candidates, new Set(['hq'])), []);
});
