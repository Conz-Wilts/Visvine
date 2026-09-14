import test from 'node:test';
import assert from 'node:assert/strict';
import { flowsUpToParent, mergeByStart, rollupEvents } from '../lib/events/rollup';

const sub = { id: 'hq-design', name: 'Design Partners' };

test('only a published, PUBLIC event of a sub-space flows up to the parent', () => {
  assert.equal(flowsUpToParent({ status: 'published', visibility: 'public' }), true);
  assert.equal(flowsUpToParent({ status: undefined, visibility: 'public' }), true);
  assert.equal(flowsUpToParent({ status: 'draft', visibility: 'public' }), false);
  assert.equal(flowsUpToParent({ status: 'published', visibility: 'space' }), false);
  assert.equal(flowsUpToParent({ status: 'published', visibility: 'private' }), false);
});

test('rolled-up events are stamped with the sub-space, and the rest never leave it', () => {
  const rolled = rollupEvents(sub, [
    { id: 'a', status: 'published', visibility: 'public' },
    { id: 'b', status: 'published', visibility: 'space' },
    { id: 'c', status: 'draft', visibility: 'public' },
  ]);
  assert.deepEqual(rolled.map((e) => e.id), ['a']);
  assert.deepEqual(rolled[0].viaSpace, { id: 'hq-design', name: 'Design Partners' });
});

test('the merged list is one calendar ordered by start', () => {
  const merged = mergeByStart(
    [{ id: 'own-late', startAt: '2026-10-03T10:00:00Z' }, { id: 'own-early', startAt: '2026-10-01T10:00:00Z' }],
    [{ id: 'sub-mid', startAt: '2026-10-02T10:00:00Z' }],
  );
  assert.deepEqual(merged.map((e) => e.id), ['own-early', 'sub-mid', 'own-late']);
});
