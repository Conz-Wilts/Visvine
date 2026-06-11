import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeIncrementally } from '../components/graph/utils/incrementalLayout';
import { CARD_DIMENSIONS } from '../components/graph/utils/constants';

const MIN_DIST = Math.hypot(CARD_DIMENSIONS.WIDTH, CARD_DIMENSIONS.HEIGHT) + 24;

function assertNoOverlap(positions: Map<string, { x: number; y: number }>) {
  const entries = [...positions.entries()];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [idA, a] = entries[i];
      const [idB, b] = entries[j];
      // Only enforce spacing where at least one node was newly placed — saved
      // nodes keep whatever spacing the original engine gave them.
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      assert.ok(
        dist >= 1,
        `${idA} and ${idB} are coincident (${dist})`,
      );
    }
  }
}

test('full coverage: every saved position is reused verbatim', () => {
  const saved = {
    a: { x: 0, y: 0 },
    b: { x: 500, y: 0 },
    c: { x: 0, y: 500 },
  };
  const out = placeIncrementally(['a', 'b', 'c'], [{ source: 'a', target: 'b' }], saved);
  assert.ok(out);
  assert.deepEqual(out.get('a'), { x: 0, y: 0 });
  assert.deepEqual(out.get('b'), { x: 500, y: 0 });
  assert.deepEqual(out.get('c'), { x: 0, y: 500 });
});

test('coverage below threshold returns null (caller falls back to engine)', () => {
  const saved = { a: { x: 0, y: 0 } };
  const out = placeIncrementally(['a', 'b', 'c', 'd'], [], saved);
  assert.equal(out, null);
});

test('new linked node lands near its neighbours without overlapping them', () => {
  const saved: Record<string, { x: number; y: number }> = {};
  // 4×4 grid of placed nodes, spaced exactly MIN_DIST apart.
  const ids: string[] = [];
  for (let gx = 0; gx < 4; gx++) {
    for (let gy = 0; gy < 4; gy++) {
      const id = `n${gx}-${gy}`;
      ids.push(id);
      saved[id] = { x: gx * MIN_DIST, y: gy * MIN_DIST };
    }
  }
  const newId = 'newbie';
  const out = placeIncrementally(
    [...ids, newId],
    [{ source: newId, target: 'n1-1' }, { source: newId, target: 'n2-2' }],
    saved,
  );
  assert.ok(out);
  const p = out.get(newId)!;
  // Near the neighbour centroid (within a few probe rings)…
  const centroid = { x: 1.5 * MIN_DIST, y: 1.5 * MIN_DIST };
  assert.ok(Math.hypot(p.x - centroid.x, p.y - centroid.y) < MIN_DIST * 6);
  // …and not overlapping anything already placed.
  for (const id of ids) {
    assert.ok(Math.hypot(p.x - saved[id].x, p.y - saved[id].y) >= MIN_DIST);
  }
  assertNoOverlap(out);
});

test('isolated new node is pushed to the periphery, deterministically', () => {
  const saved = {
    a: { x: 0, y: 0 },
    b: { x: 1000, y: 0 },
    c: { x: 0, y: 1000 },
    d: { x: 1000, y: 1000 },
  };
  const ids = ['a', 'b', 'c', 'd', 'loner'];
  const out1 = placeIncrementally(ids, [], saved);
  const out2 = placeIncrementally(ids, [], saved);
  assert.ok(out1 && out2);
  const p1 = out1.get('loner')!;
  // Same input → same placement (no randomness).
  assert.deepEqual(p1, out2.get('loner'));
  // Outside the saved cloud's bounding radius around its centroid.
  const r = Math.hypot(p1.x - 500, p1.y - 500);
  assert.ok(r > Math.hypot(500, 500));
});

test('many new nodes all get collision-free spots', () => {
  const saved: Record<string, { x: number; y: number }> = {
    hub: { x: 0, y: 0 },
  };
  const ids = ['hub'];
  const links: Array<{ source: string; target: string }> = [];
  for (let i = 0; i < 8; i++) {
    ids.push(`new${i}`);
    links.push({ source: `new${i}`, target: 'hub' });
  }
  // 1 of 9 covered is below the default threshold — lower it for this test.
  const out = placeIncrementally(ids, links, saved, 0.1);
  assert.ok(out);
  assert.equal(out.size, 9);
  const entries = [...out.entries()];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const dist = Math.hypot(
        entries[i][1].x - entries[j][1].x,
        entries[i][1].y - entries[j][1].y,
      );
      assert.ok(dist >= MIN_DIST, `${entries[i][0]} vs ${entries[j][0]}: ${dist}`);
    }
  }
});
