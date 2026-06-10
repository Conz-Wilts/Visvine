import test from 'node:test';
import assert from 'node:assert/strict';
import {
  layoutGraph,
  layoutGraphAsync,
  type GraphEdgeInput,
  type GraphNodeInput,
  type LayoutResult,
} from '../lib/graph-layout/graphLayout';

/* ------------------------------ helpers ------------------------------ */

function mkNodes(n: number, r?: number): GraphNodeInput[] {
  return Array.from({ length: n }, (_, i) => ({ id: `n${i}`, r }));
}

function seededRandomGraph(
  n: number,
  m: number,
  seed = 42,
): { nodes: GraphNodeInput[]; edges: GraphEdgeInput[] } {
  // mulberry32, locally — test-side generator independent of the engine.
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const nodes = mkNodes(n);
  const edges: GraphEdgeInput[] = [];
  // Spanning tree first so the graph is connected, then extra random edges.
  for (let i = 1; i < n; i++) {
    edges.push({ source: `n${Math.floor(rng() * i)}`, target: `n${i}` });
  }
  while (edges.length < m) {
    const u = Math.floor(rng() * n);
    const v = Math.floor(rng() * n);
    if (u !== v) edges.push({ source: `n${u}`, target: `n${v}` });
  }
  return { nodes, edges };
}

/** Exhaustive O(n²) overlap check — independent of the engine's own grid. */
function overlappingPairs(result: LayoutResult): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const ns = result.nodes;
  for (let i = 0; i < ns.length; i++) {
    for (let j = i + 1; j < ns.length; j++) {
      const rr = ns[i].r + ns[j].r;
      const dx = ns[i].x - ns[j].x;
      const dy = ns[i].y - ns[j].y;
      if (dx * dx + dy * dy < rr * rr - 1e-6) out.push([i, j]);
    }
  }
  return out;
}

function assertNoOverlap(result: LayoutResult, label: string): void {
  const pairs = overlappingPairs(result);
  assert.equal(
    pairs.length,
    0,
    `${label}: found ${pairs.length} overlapping pairs, e.g. ${JSON.stringify(pairs.slice(0, 3))}`,
  );
  assert.equal(result.stats.overlapPairs, 0, `${label}: engine self-report disagrees`);
}

function assertInViewport(result: LayoutResult, w: number, h: number, label: string): void {
  for (const nd of result.nodes) {
    assert.ok(
      nd.x - nd.r >= -1e-6 && nd.x + nd.r <= w + 1e-6,
      `${label}: node ${nd.id} x=${nd.x} r=${nd.r} outside [0, ${w}]`,
    );
    assert.ok(
      nd.y - nd.r >= -1e-6 && nd.y + nd.r <= h + 1e-6,
      `${label}: node ${nd.id} y=${nd.y} r=${nd.r} outside [0, ${h}]`,
    );
  }
}

/* ------------------------------- tests ------------------------------- */

test('empty graph returns an empty, well-formed result', () => {
  const res = layoutGraph([], []);
  assert.deepEqual(res.nodes, []);
  assert.equal(res.stats.overlapPairs, 0);
});

test('single node is centered in the viewport', () => {
  const res = layoutGraph([{ id: 'only' }], [], { width: 1000, height: 600 });
  assert.equal(res.nodes.length, 1);
  assert.ok(Math.abs(res.nodes[0].x - 500) < 1);
  assert.ok(Math.abs(res.nodes[0].y - 300) < 1);
});

test('two connected nodes sit roughly an ideal edge length apart', () => {
  const res = layoutGraph(mkNodes(2), [{ source: 'n0', target: 'n1' }], {
    idealEdgeLength: 50,
    maxUpscale: 1,
  });
  const [a, b] = res.nodes;
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  assert.ok(d > 20 && d < 80, `distance ${d} not near K=50`);
});

test('all nodes and edges are present in the output', () => {
  const { nodes, edges } = seededRandomGraph(120, 200);
  const res = layoutGraph(nodes, edges);
  assert.equal(res.nodes.length, 120);
  assert.equal(res.edges.length, edges.length);
  const ids = new Set(res.nodes.map((n) => n.id));
  for (const nd of nodes) assert.ok(ids.has(nd.id), `missing node ${nd.id}`);
  for (const nd of res.nodes) {
    assert.ok(Number.isFinite(nd.x) && Number.isFinite(nd.y), `non-finite coords for ${nd.id}`);
  }
});

test('zero node-node overlap on a mid-size random graph', () => {
  const { nodes, edges } = seededRandomGraph(400, 700);
  const res = layoutGraph(nodes, edges);
  assertNoOverlap(res, 'random-400');
  assertInViewport(res, 1200, 800, 'random-400');
});

test('zero overlap on a dense clique (worst-case local density)', () => {
  const n = 30;
  const nodes = mkNodes(n);
  const edges: GraphEdgeInput[] = [];
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) edges.push({ source: `n${i}`, target: `n${j}` });
  const res = layoutGraph(nodes, edges);
  assertNoOverlap(res, 'K30');
});

test('high-degree hub: star with 150 leaves, no overlap, hub near centroid', () => {
  const nodes = mkNodes(151);
  const edges: GraphEdgeInput[] = [];
  for (let i = 1; i <= 150; i++) edges.push({ source: 'n0', target: `n${i}` });
  const res = layoutGraph(nodes, edges);
  assertNoOverlap(res, 'star-150');
  const hub = res.nodes.find((n) => n.id === 'n0')!;
  let cx = 0;
  let cy = 0;
  for (const nd of res.nodes) {
    if (nd.id === 'n0') continue;
    cx += nd.x;
    cy += nd.y;
  }
  cx /= 150;
  cy /= 150;
  // The hub should sit inside its leaf cloud, not flung to the periphery.
  const spread = Math.max(
    ...res.nodes.filter((n) => n.id !== 'n0').map((n) => Math.hypot(n.x - cx, n.y - cy)),
  );
  const offCenter = Math.hypot(hub.x - cx, hub.y - cy);
  assert.ok(
    offCenter < spread * 0.5,
    `hub is ${offCenter} from leaf centroid; leaf spread is ${spread}`,
  );
});

test('cycle: a 60-ring lays out with zero crossings', () => {
  const n = 60;
  const nodes = mkNodes(n);
  const edges: GraphEdgeInput[] = [];
  for (let i = 0; i < n; i++) edges.push({ source: `n${i}`, target: `n${(i + 1) % n}` });
  const res = layoutGraph(nodes, edges);
  assertNoOverlap(res, 'ring-60');
  assert.equal(res.stats.edgeCrossings, 0, 'a simple cycle should render planar');
});

test('isolated nodes settle on the periphery of the cloud, overlap-free', () => {
  const { nodes, edges } = seededRandomGraph(80, 140);
  for (let i = 0; i < 25; i++) nodes.push({ id: `iso${i}` });
  const res = layoutGraph(nodes, edges);
  assertNoOverlap(res, 'isolated-periphery');
  assert.equal(res.stats.isolatedCount, 25);
  // Isolated singletons are composed last, so they should ring the outside
  // of the cloud rather than sit inside the connected core.
  const iso = res.nodes.filter((n) => String(n.id).startsWith('iso'));
  const core = res.nodes.filter((n) => !String(n.id).startsWith('iso'));
  const cx = res.nodes.reduce((s, n) => s + n.x, 0) / res.nodes.length;
  const cy = res.nodes.reduce((s, n) => s + n.y, 0) / res.nodes.length;
  const meanDist = (ns: typeof res.nodes) =>
    ns.reduce((s, n) => s + Math.hypot(n.x - cx, n.y - cy), 0) / ns.length;
  assert.ok(
    meanDist(iso) > meanDist(core),
    `isolated nodes should sit outside the core (iso ${meanDist(iso).toFixed(1)} vs core ${meanDist(core).toFixed(1)})`,
  );
});

test('many small components compose into a roughly circular cloud, not a grid', () => {
  // 40 star components of 2–6 nodes — the directory-of-small-clusters shape
  // the old shelf packing arranged into rows and columns of same-sized boxes.
  const nodes: GraphNodeInput[] = [];
  const edges: GraphEdgeInput[] = [];
  for (let c = 0; c < 40; c++) {
    const size = 2 + (c % 5);
    for (let i = 0; i < size; i++) nodes.push({ id: `c${c}_${i}` });
    for (let i = 1; i < size; i++) edges.push({ source: `c${c}_0`, target: `c${c}_${i}` });
  }
  const res = layoutGraph(nodes, edges);
  assertNoOverlap(res, 'cluster-cloud');
  // The composed silhouette should be near-circular (shelf packing tracked
  // the 1200×800 viewport aspect instead, landing near 1.5).
  const aspect = res.bounds.width / res.bounds.height;
  assert.ok(
    aspect > 0.75 && aspect < 1.35,
    `cluster cloud aspect ${aspect.toFixed(2)} is not roughly circular`,
  );
});

test('disconnected components are packed without overlap', () => {
  // Three separate communities plus a ring plus isolated nodes.
  const nodes: GraphNodeInput[] = [];
  const edges: GraphEdgeInput[] = [];
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < 40; i++) nodes.push({ id: `c${c}_${i}` });
    for (let i = 1; i < 40; i++) {
      edges.push({ source: `c${c}_${Math.floor(i / 2)}`, target: `c${c}_${i}` });
    }
  }
  for (let i = 0; i < 20; i++) nodes.push({ id: `r${i}` });
  for (let i = 0; i < 20; i++) edges.push({ source: `r${i}`, target: `r${(i + 1) % 20}` });
  for (let i = 0; i < 5; i++) nodes.push({ id: `solo${i}` });
  const res = layoutGraph(nodes, edges);
  assertNoOverlap(res, 'multi-component');
  assert.equal(res.stats.componentCount, 9); // 3 trees + 1 ring + 5 singletons
});

test('self-loops, duplicate edges, duplicate nodes, dangling edges are tolerated', () => {
  const nodes: GraphNodeInput[] = [
    { id: 'a' },
    { id: 'b' },
    { id: 'a' }, // duplicate id
    { id: 'c' },
  ];
  const edges: GraphEdgeInput[] = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'a' }, // reverse duplicate
    { source: 'a', target: 'a' }, // self loop
    { source: 'a', target: 'ghost' }, // dangling
    { source: 'b', target: 'c' },
  ];
  const res = layoutGraph(nodes, edges);
  assert.equal(res.nodes.length, 3); // a, b, c
  assert.equal(res.edges.length, 5); // inputs echoed verbatim
  assertNoOverlap(res, 'dirty-input');
});

test('determinism: identical input produces identical output', () => {
  const { nodes, edges } = seededRandomGraph(200, 350, 7);
  const r1 = layoutGraph(nodes, edges);
  const r2 = layoutGraph(nodes, edges);
  for (let i = 0; i < r1.nodes.length; i++) {
    assert.equal(r1.nodes[i].x, r2.nodes[i].x, `x differs at ${String(r1.nodes[i].id)}`);
    assert.equal(r1.nodes[i].y, r2.nodes[i].y, `y differs at ${String(r1.nodes[i].id)}`);
  }
});

test('seed option changes the layout, same seed reproduces it', () => {
  const { nodes, edges } = seededRandomGraph(100, 160, 3);
  const a = layoutGraph(nodes, edges, { seed: 'alpha' });
  const b = layoutGraph(nodes, edges, { seed: 'alpha' });
  const c = layoutGraph(nodes, edges, { seed: 'beta' });
  assert.deepEqual(
    a.nodes.map((n) => [n.x, n.y]),
    b.nodes.map((n) => [n.x, n.y]),
  );
  const moved = c.nodes.some((nd, i) => nd.x !== a.nodes[i].x || nd.y !== a.nodes[i].y);
  assert.ok(moved, 'different seed should perturb the layout');
});

test('crossing reduction: ladder graph ends up with few crossings', () => {
  // A 2×20 grid ("ladder") is planar; a decent layout should be near-planar.
  const nodes: GraphNodeInput[] = [];
  const edges: GraphEdgeInput[] = [];
  const L = 20;
  for (let i = 0; i < L; i++) {
    nodes.push({ id: `t${i}` }, { id: `b${i}` });
    edges.push({ source: `t${i}`, target: `b${i}` });
    if (i > 0) {
      edges.push({ source: `t${i - 1}`, target: `t${i}` });
      edges.push({ source: `b${i - 1}`, target: `b${i}` });
    }
  }
  const res = layoutGraph(nodes, edges);
  assertNoOverlap(res, 'ladder');
  assert.ok(
    res.stats.edgeCrossings <= 3,
    `ladder should be near-planar, got ${res.stats.edgeCrossings} crossings`,
  );
});

test('performance: 2000 nodes / 4000 edges completes inside 3 seconds', () => {
  const { nodes, edges } = seededRandomGraph(2000, 4000, 11);
  const t0 = performance.now();
  const res = layoutGraph(nodes, edges, { timeBudgetMs: 2500 });
  const wall = performance.now() - t0;
  assert.ok(wall < 3000, `layout took ${wall.toFixed(0)} ms`);
  assertNoOverlap(res, 'perf-2000');
  assert.equal(res.nodes.length, 2000);
});

test('performance: 5000 nodes / 10000 edges respects the budget and stays overlap-free', () => {
  const { nodes, edges } = seededRandomGraph(5000, 10000, 13);
  const t0 = performance.now();
  const res = layoutGraph(nodes, edges, { timeBudgetMs: 2500 });
  const wall = performance.now() - t0;
  assert.ok(wall < 3500, `layout took ${wall.toFixed(0)} ms (budget 2500 + slack)`);
  assertNoOverlap(res, 'perf-5000');
});

test('async driver emits progressive snapshots and matches the contract', async () => {
  const { nodes, edges } = seededRandomGraph(600, 1000, 5);
  const phases: string[] = [];
  let snapshotNodes = 0;
  const res = await layoutGraphAsync(nodes, edges, {
    onProgress: (snap) => {
      phases.push(snap.phase);
      snapshotNodes = snap.nodes.length;
    },
  });
  assert.ok(phases.length >= 1, 'expected at least one progress snapshot');
  assert.equal(snapshotNodes, 600, 'snapshots must include every node');
  assertNoOverlap(res, 'async-600');
});

test('crossing counter: counts a proper crossing, ignores shared endpoints', () => {
  // X shape: (a-b) crosses (c-d); (a-c) shares endpoints with both.
  const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const edges = [
    { source: 'a', target: 'b' },
    { source: 'c', target: 'd' },
    { source: 'a', target: 'c' },
  ];
  // K4-minus is planar; engine should lay it out without crossings at all.
  const res = layoutGraph(nodes, edges);
  assert.equal(res.stats.edgeCrossings, 0);
});

test('giant node radii: ideal edge length auto-scales, no overlap, planar tree', () => {
  // r=150 nodes dwarf the default K=48; without auto-derived K the springs
  // and collision passes fight and edges thread through nodes.
  const nodes = Array.from({ length: 100 }, (_, i) => ({ id: `g${i}`, r: 150 }));
  const edges = Array.from({ length: 99 }, (_, i) => ({
    source: `g${Math.floor(i / 3)}`,
    target: `g${i + 1}`,
  }));
  const res = layoutGraph(nodes, edges);
  assertNoOverlap(res, 'giant-radii');
  assert.equal(res.stats.edgeCrossings, 0, 'a tree of giant nodes should stay planar');
});

test('timeBudgetMs=0 still returns a complete overlap-free layout', () => {
  const { nodes, edges } = seededRandomGraph(800, 1400, 21);
  const res = layoutGraph(nodes, edges, { timeBudgetMs: 0 });
  assert.equal(res.nodes.length, 800);
  assertNoOverlap(res, 'budget-0');
  assert.equal(res.stats.budgetExceeded, true);
});

test('honors viewport and padding for everything including the shelf', () => {
  const { nodes, edges } = seededRandomGraph(150, 250, 9);
  for (let i = 0; i < 40; i++) nodes.push({ id: `iso${i}` });
  const W = 900;
  const H = 500;
  const res = layoutGraph(nodes, edges, { width: W, height: H, padding: 20 });
  assertInViewport(res, W, H, 'viewport');
  // bounds sanity
  assert.ok(res.bounds.width <= W + 1e-6);
  assert.ok(res.bounds.height <= H + 1e-6);
});
