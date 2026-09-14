import test from 'node:test';
import assert from 'node:assert/strict';
import { crossesPeopleFlow, isViaNode, mergePeopleFlow, stampVia } from '../lib/directory/peopleFlow';
import { isStructuralNodeType } from '../lib/types/context';

const room = { id: 'hq-design', name: 'Design Partners' };

test('only people and organisations cross: never events, never structural kinds', () => {
  assert.equal(crossesPeopleFlow({ type: 'person' }, isStructuralNodeType), true);
  assert.equal(crossesPeopleFlow({ type: 'space' }, isStructuralNodeType), true);
  assert.equal(crossesPeopleFlow({ type: 'event' }, isStructuralNodeType), false);
  assert.equal(crossesPeopleFlow({ type: 'Event' }, isStructuralNodeType), false);
  assert.equal(crossesPeopleFlow({ type: 'note' }, isStructuralNodeType), false);
  assert.equal(crossesPeopleFlow({ type: 'connector' }, isStructuralNodeType), false);
});

test('a room’s nodes are stamped with the room, and the stamp is the read-only signal', () => {
  const stamped = stampVia([{ id: 'person:a', name: 'A' }], room);
  assert.deepEqual(stamped[0].via_space, { id: 'hq-design', name: 'Design Partners' });
  assert.equal(isViaNode(stamped[0]), true);
  assert.equal(isViaNode({ id: 'person:b' }), false);
  assert.equal(isViaNode(null), false);
});

test('the house’s own rows come first and are never shadowed by a room’s copy', () => {
  const merged = mergePeopleFlow(
    [{ id: 'person:a', name: 'A (house)' }, { id: 'person:b', name: 'B' }],
    [
      { room, nodes: [{ id: 'person:a', name: 'A (room)' }, { id: 'person:c', name: 'C' }] },
      { room: { id: 'hq-leads', name: 'Leadership' }, nodes: [{ id: 'person:c', name: 'C again' }, { id: 'person:d', name: 'D' }] },
    ],
  );
  assert.deepEqual(merged.map((n) => n.id), ['person:a', 'person:b', 'person:c', 'person:d']);
  assert.equal(merged[0].name, 'A (house)');
  assert.equal(merged[0].via_space, undefined);
  assert.deepEqual(merged[2].via_space, room);
  assert.equal(merged[3].via_space?.name, 'Leadership');
});
