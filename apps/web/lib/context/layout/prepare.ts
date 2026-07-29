// Stage 1 — DECOMPOSE: dedupe the input into a CSR-indexed PreparedContext,
// then split it into connected components with their own local index spaces.

import type { Component, ContextEdgeInput, ContextNodeInput, NodeId, PreparedContext } from './types';

export function prepareContext(
  nodesIn: ContextNodeInput[],
  edgesIn: ContextEdgeInput[],
  defaultR: number,
): PreparedContext {
  // Dedupe nodes by id, preserving first occurrence (stable + deterministic).
  const index = new Map<NodeId, number>();
  const ids: NodeId[] = [];
  const radiiList: number[] = [];
  for (const nd of nodesIn) {
    if (index.has(nd.id)) continue;
    index.set(nd.id, ids.length);
    ids.push(nd.id);
    // Reject non-finite/non-positive radii and clamp absurd ones: a single
    // r = Infinity would otherwise poison the K derivation and send the
    // quadtree's coincident-point jiggle loop spinning forever.
    const r = nd.r;
    radiiList.push(
      r !== undefined && Number.isFinite(r) && r > 0 ? Math.min(r, 1e7) : defaultR,
    );
  }
  const n = ids.length;
  const radii = Float64Array.from(radiiList);

  // Dedupe undirected edges; drop self-loops and dangling references.
  // Key a*n+b (a<b) is unique and stays a safe integer for n < 2^26.
  const seen = new Set<number>();
  const pairs: number[] = [];
  for (const e of edgesIn) {
    const a = index.get(e.source);
    const b = index.get(e.target);
    if (a === undefined || b === undefined || a === b) continue;
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const key = lo * n + hi;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push(lo, hi);
  }
  const edgePairs = Int32Array.from(pairs);
  const m = edgePairs.length / 2;

  // CSR adjacency (both directions).
  const degree = new Int32Array(n);
  for (let i = 0; i < m; i++) {
    degree[edgePairs[2 * i]]++;
    degree[edgePairs[2 * i + 1]]++;
  }
  const adjOffsets = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) adjOffsets[i + 1] = adjOffsets[i] + degree[i];
  const adjTargets = new Int32Array(adjOffsets[n]);
  const cursor = adjOffsets.slice(0, n);
  for (let i = 0; i < m; i++) {
    const a = edgePairs[2 * i];
    const b = edgePairs[2 * i + 1];
    adjTargets[cursor[a]++] = b;
    adjTargets[cursor[b]++] = a;
  }
  return { n, ids, radii, edgePairs, adjOffsets, adjTargets, degree };
}

/** Union-find with union-by-size and path halving: O(m·α(n)). */
export function connectedComponents(g: PreparedContext): Int32Array {
  const parent = new Int32Array(g.n);
  const size = new Int32Array(g.n).fill(1);
  for (let i = 0; i < g.n; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]; // path halving
      x = parent[x];
    }
    return x;
  };
  const m = g.edgePairs.length / 2;
  for (let i = 0; i < m; i++) {
    let a = find(g.edgePairs[2 * i]);
    let b = find(g.edgePairs[2 * i + 1]);
    if (a === b) continue;
    if (size[a] < size[b]) {
      const t = a;
      a = b;
      b = t;
    }
    parent[b] = a;
    size[a] += size[b];
  }
  const roots = new Int32Array(g.n);
  for (let i = 0; i < g.n; i++) roots[i] = find(i);
  return roots;
}

export function buildComponents(g: PreparedContext, roots: Int32Array): Component[] {
  const byRoot = new Map<number, number[]>();
  for (let i = 0; i < g.n; i++) {
    let list = byRoot.get(roots[i]);
    if (!list) byRoot.set(roots[i], (list = []));
    list.push(i);
  }
  // Deterministic ordering: largest first (gets refinement budget first),
  // ties broken by smallest member index.
  const groups = [...byRoot.values()].sort(
    (a, b) => b.length - a.length || a[0] - b[0],
  );
  const localOf = new Int32Array(g.n);
  const comps: Component[] = [];
  for (const group of groups) {
    const n = group.length;
    const globals = Int32Array.from(group);
    for (let i = 0; i < n; i++) localOf[group[i]] = i;
    const edges: number[] = [];
    const degree = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const gi = group[i];
      for (let e = g.adjOffsets[gi]; e < g.adjOffsets[gi + 1]; e++) {
        const gj = g.adjTargets[e];
        if (gj > gi) {
          edges.push(localOf[gi], localOf[gj]);
        }
      }
      degree[i] = g.adjOffsets[gi + 1] - g.adjOffsets[gi];
    }
    const edgeArr = Int32Array.from(edges);
    const adjOffsets = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) adjOffsets[i + 1] = adjOffsets[i] + degree[i];
    const adjTargets = new Int32Array(adjOffsets[n]);
    const cursor = adjOffsets.slice(0, n);
    const m = edgeArr.length / 2;
    for (let i = 0; i < m; i++) {
      const a = edgeArr[2 * i];
      const b = edgeArr[2 * i + 1];
      adjTargets[cursor[a]++] = b;
      adjTargets[cursor[b]++] = a;
    }
    const radii = new Float64Array(n);
    for (let i = 0; i < n; i++) radii[i] = g.radii[group[i]];
    comps.push({
      globals,
      edges: edgeArr,
      adjOffsets,
      adjTargets,
      degree,
      radii,
      px: new Float64Array(n),
      py: new Float64Array(n),
    });
  }
  return comps;
}

/* ================================== BFS ================================== */

/**
 * Unweighted BFS writing hop counts into `dist` (-1 = unreached).
 * Used by PivotMDS columns and by the phyllotaxis ordering.
 */
export function bfs(
  comp: Component,
  source: number,
  dist: Int32Array,
  queue: Int32Array,
): void {
  dist.fill(-1);
  dist[source] = 0;
  queue[0] = source;
  let head = 0;
  let tail = 1;
  while (head < tail) {
    const u = queue[head++];
    const du = dist[u];
    for (let e = comp.adjOffsets[u]; e < comp.adjOffsets[u + 1]; e++) {
      const v = comp.adjTargets[e];
      if (dist[v] === -1) {
        dist[v] = du + 1;
        queue[tail++] = v;
      }
    }
  }
}
