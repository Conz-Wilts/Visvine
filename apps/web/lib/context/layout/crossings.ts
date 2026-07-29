// Stage 5 — POLISH: uniform-grid segment index over a component's edges,
// PrEd-style node-edge repulsion, and greedy vertex-move crossing reduction.

import type { Component, Rng } from './types';
import { now } from './rng';

/**
 * Uniform-grid spatial index over edge segments. Cells are keyed on a dense
 * integer lattice; each segment registers in every cell it passes through
 * (Amanatides-Woo traversal). Crossing candidates are segments sharing a
 * cell — expected O(m + X) total work for realistic layouts, versus the
 * O((m+X) log m) and brutal robustness engineering of Bentley-Ottmann.
 */
export interface SegGrid {
  cell: number;
  minX: number;
  minY: number;
  cols: number;
  map: Map<number, number[]>;
  /** cells occupied by each edge, for honest removal on vertex moves */
  edgeCells: number[][];
}

function cellsOfSegment(
  grid: SegGrid,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  out: number[],
): void {
  const inv = 1 / grid.cell;
  let cx = Math.floor((ax - grid.minX) * inv);
  let cy = Math.floor((ay - grid.minY) * inv);
  const ex = Math.floor((bx - grid.minX) * inv);
  const ey = Math.floor((by - grid.minY) * inv);
  out.push(cy * grid.cols + cx);
  if (cx === ex && cy === ey) return;
  // Amanatides-Woo voxel walk. Division by zero yields ±Infinity, which
  // correctly freezes that axis for horizontal/vertical segments.
  const dx = bx - ax;
  const dy = by - ay;
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const nextX = grid.minX + (cx + (dx > 0 ? 1 : 0)) * grid.cell;
  const nextY = grid.minY + (cy + (dy > 0 ? 1 : 0)) * grid.cell;
  let tMaxX = dx !== 0 ? (nextX - ax) / dx : Infinity;
  let tMaxY = dy !== 0 ? (nextY - ay) / dy : Infinity;
  const tDeltaX = dx !== 0 ? Math.abs(grid.cell / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(grid.cell / dy) : Infinity;
  let guard = 4 * (Math.abs(ex - cx) + Math.abs(ey - cy)) + 8;
  while ((cx !== ex || cy !== ey) && guard-- > 0) {
    if (tMaxX < tMaxY) {
      cx += stepX;
      tMaxX += tDeltaX;
    } else {
      cy += stepY;
      tMaxY += tDeltaY;
    }
    out.push(cy * grid.cols + cx);
  }
  // FP insurance: if a corner-case misstep exhausted the guard before
  // landing on the end cell, register it anyway (a duplicate is harmless;
  // a missing end cell would hide crossings near the segment's endpoint).
  const endKey = ey * grid.cols + ex;
  if (out[out.length - 1] !== endKey) out.push(endKey);
}

export function buildSegGrid(
  comp: Component,
  K: number,
): SegGrid {
  const m = comp.edges.length / 2;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  const n = comp.globals.length;
  for (let i = 0; i < n; i++) {
    if (comp.px[i] < minX) minX = comp.px[i];
    if (comp.px[i] > maxX) maxX = comp.px[i];
    if (comp.py[i] < minY) minY = comp.py[i];
  }
  // Cell ≈ K: edges average ~K long, so most occupy only a handful of cells.
  const cell = Math.max(K, 1e-6);
  const cols = Math.max(1, Math.ceil((maxX - minX) / cell) + 2);
  const grid: SegGrid = {
    cell,
    minX: minX - cell,
    minY: minY - cell,
    cols: cols + 2,
    map: new Map(),
    edgeCells: [],
  };
  for (let e = 0; e < m; e++) {
    const a = comp.edges[2 * e];
    const b = comp.edges[2 * e + 1];
    const cells: number[] = [];
    cellsOfSegment(grid, comp.px[a], comp.py[a], comp.px[b], comp.py[b], cells);
    grid.edgeCells.push(cells);
    for (const c of cells) {
      let list = grid.map.get(c);
      if (!list) grid.map.set(c, (list = []));
      list.push(e);
    }
  }
  return grid;
}

function gridRemoveEdge(grid: SegGrid, e: number): void {
  for (const c of grid.edgeCells[e]) {
    const list = grid.map.get(c);
    if (!list) continue;
    const idx = list.indexOf(e);
    if (idx >= 0) list.splice(idx, 1);
  }
  grid.edgeCells[e] = [];
}

function gridAddEdge(grid: SegGrid, comp: Component, e: number): void {
  const a = comp.edges[2 * e];
  const b = comp.edges[2 * e + 1];
  const cells: number[] = [];
  cellsOfSegment(grid, comp.px[a], comp.py[a], comp.px[b], comp.py[b], cells);
  grid.edgeCells[e] = cells;
  for (const c of cells) {
    let list = grid.map.get(c);
    if (!list) grid.map.set(c, (list = []));
    list.push(e);
  }
}

/** 2×signed area of triangle abc — the standard orientation predicate. */
function orient(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/** Proper (interior) segment crossing. Shared-endpoint contact and collinear
 *  touching do not count — adjacent edges always "touch" at their vertex. */
function segmentsCross(
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
  q1x: number,
  q1y: number,
  q2x: number,
  q2y: number,
): boolean {
  const o1 = orient(p1x, p1y, p2x, p2y, q1x, q1y);
  const o2 = orient(p1x, p1y, p2x, p2y, q2x, q2y);
  if (o1 * o2 >= 0) return false;
  const o3 = orient(q1x, q1y, q2x, q2y, p1x, p1y);
  const o4 = orient(q1x, q1y, q2x, q2y, p2x, p2y);
  return o3 * o4 < 0;
}

function edgesShareVertex(comp: Component, e1: number, e2: number): boolean {
  const a1 = comp.edges[2 * e1];
  const b1 = comp.edges[2 * e1 + 1];
  const a2 = comp.edges[2 * e2];
  const b2 = comp.edges[2 * e2 + 1];
  return a1 === a2 || a1 === b2 || b1 === a2 || b1 === b2;
}

function edgeCross(comp: Component, e1: number, e2: number): boolean {
  if (edgesShareVertex(comp, e1, e2)) return false;
  const a1 = comp.edges[2 * e1];
  const b1 = comp.edges[2 * e1 + 1];
  const a2 = comp.edges[2 * e2];
  const b2 = comp.edges[2 * e2 + 1];
  return segmentsCross(
    comp.px[a1], comp.py[a1], comp.px[b1], comp.py[b1],
    comp.px[a2], comp.py[a2], comp.px[b2], comp.py[b2],
  );
}

/**
 * Count all proper crossings in a component; optionally per-edge tallies.
 * Returns -1 if the deadline expired or internal limits tripped (callers
 * must treat the count as unavailable, not zero).
 *
 * Hub safety: edges sharing a vertex (a degree-d hub puts d segments in one
 * cell ⇒ C(d,2) pairs) are rejected BEFORE touching the dedupe set — they
 * can never properly cross, and admitting them would blow V8's ~2²⁴ Set cap
 * on hub-heavy contexts. The remaining true candidates are deadline-checked.
 */
export function countComponentCrossings(
  comp: Component,
  grid: SegGrid,
  perEdge: Int32Array | null,
  deadline = Infinity,
): number {
  const m = comp.edges.length / 2;
  const seen = new Set<number>();
  let total = 0;
  let sinceCheck = 0;
  for (const list of grid.map.values()) {
    const len = list.length;
    if (len > 4096) continue; // pathological pile-up: skip, deadline-safe
    sinceCheck += (len * (len - 1)) / 2;
    if (sinceCheck > 32768) {
      sinceCheck = 0;
      if (now() > deadline) return -1;
      if (seen.size > 6_000_000) return -1; // stay far from the Set cap
    }
    for (let i = 0; i < len; i++) {
      for (let j = i + 1; j < len; j++) {
        const e1 = list[i] < list[j] ? list[i] : list[j];
        const e2 = list[i] < list[j] ? list[j] : list[i];
        if (e1 === e2) continue;
        if (edgesShareVertex(comp, e1, e2)) continue; // cheap, pre-Set
        const key = e1 * m + e2;
        if (seen.has(key)) continue;
        seen.add(key);
        if (edgeCross(comp, e1, e2)) {
          total++;
          if (perEdge) {
            perEdge[e1]++;
            perEdge[e2]++;
          }
        }
      }
    }
  }
  return total;
}

/**
 * PrEd node-edge repulsion (Bertault, GD 2000): a vertex v closer than γ to a
 * non-incident edge is pushed off the edge's supporting line with magnitude
 * (γ−d)²/d — quadratic in penetration depth, singular at contact. This kills
 * the worst perceptual defect short of overlap: an edge grazing through an
 * unrelated node reads as a false incidence.
 */
export function applyNodeEdgeRepulsion(
  comp: Component,
  fx: Float64Array,
  fy: Float64Array,
  K: number,
): void {
  const n = comp.globals.length;
  const grid = buildSegGrid(comp, K);
  const inv = 1 / grid.cell;
  const stamp = new Int32Array(comp.edges.length / 2).fill(-1);
  for (let v = 0; v < n; v++) {
    const gamma = 3 * comp.radii[v];
    const x = comp.px[v];
    const y = comp.py[v];
    const c0x = Math.floor((x - gamma - grid.minX) * inv);
    const c1x = Math.floor((x + gamma - grid.minX) * inv);
    const c0y = Math.floor((y - gamma - grid.minY) * inv);
    const c1y = Math.floor((y + gamma - grid.minY) * inv);
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const list = grid.map.get(cy * grid.cols + cx);
        if (!list) continue;
        for (const e of list) {
          if (stamp[e] === v) continue;
          stamp[e] = v;
          const a = comp.edges[2 * e];
          const b = comp.edges[2 * e + 1];
          if (a === v || b === v) continue;
          const abx = comp.px[b] - comp.px[a];
          const aby = comp.py[b] - comp.py[a];
          const len2 = abx * abx + aby * aby;
          if (len2 < 1e-12) continue;
          const t = ((x - comp.px[a]) * abx + (y - comp.py[a]) * aby) / len2;
          if (t <= 0 || t >= 1) continue; // beyond the segment: node-node forces own it
          const projX = comp.px[a] + t * abx;
          const projY = comp.py[a] + t * aby;
          let dx = x - projX;
          let dy = y - projY;
          let d = Math.sqrt(dx * dx + dy * dy);
          if (d >= gamma) continue;
          if (d < 0.05 * gamma) {
            // On-the-line degenerate: push perpendicular to the edge —
            // toward the side the node is actually on (a fixed side would
            // shove nodes THROUGH the edge from the other side).
            const il = 1 / Math.sqrt(len2);
            const side =
              abx * (y - comp.py[a]) - aby * (x - comp.px[a]) >= 0 ? 1 : -1;
            dx = -aby * il * side;
            dy = abx * il * side;
            d = 0.05 * gamma;
          } else {
            dx /= d;
            dy /= d;
          }
          const mag = ((gamma - d) * (gamma - d)) / d;
          fx[v] += dx * mag;
          fy[v] += dy * mag;
        }
      }
    }
  }
}

/**
 * Greedy vertex-move crossing reduction (the practical scheme of Demel et
 * al. GD'18 / Radermacher & Rutter ESA'19): repeatedly take a vertex whose
 * incident edges participate in many crossings, sample candidate positions
 * in two concentric shrinking squares around it, count only the crossings of
 * its OWN incident edges (grid-local — this is what makes a move ~O(deg)),
 * and accept strictly-improving moves that don't create node overlap.
 * Exact minimization is NP-hard and APX-hard; this is the published
 * cost-effective heuristic family for a time-boxed post-pass.
 */
export function reduceCrossings(
  comp: Component,
  K: number,
  pad: number,
  rng: Rng,
  deadline: number,
): number {
  const n = comp.globals.length;
  const m = comp.edges.length / 2;
  if (n < 4 || m < 3) return 0;

  const grid = buildSegGrid(comp, K);
  const perEdge = new Int32Array(m);
  // Deadline-aware census: on timeout (or zero crossings) the pass is moot.
  const census = countComponentCrossings(comp, grid, perEdge, deadline);
  if (census <= 0) return 0;

  // Incident-edge index so accepted moves don't rescan all m edges.
  const incident: number[][] = Array.from({ length: n }, () => []);
  for (let e = 0; e < m; e++) {
    incident[comp.edges[2 * e]].push(e);
    incident[comp.edges[2 * e + 1]].push(e);
  }

  // Vertex badness = crossings on incident edges. Hubs are excluded: moving
  // a degree-d vertex costs O(d · cell-density) per candidate and hub moves
  // rarely help (their crossings are load-bearing structure, not accidents).
  const score = new Float64Array(n);
  for (let e = 0; e < m; e++) {
    score[comp.edges[2 * e]] += perEdge[e];
    score[comp.edges[2 * e + 1]] += perEdge[e];
  }
  const order = Array.from({ length: n }, (_, i) => i)
    .filter((v) => score[v] > 0 && comp.degree[v] <= 64)
    .sort((a, b) => score[b] - score[a] || a - b)
    .slice(0, Math.min(160, n));

  // Node-proximity hash for overlap rejection of candidate positions.
  let maxR = 0;
  for (let i = 0; i < n; i++) if (comp.radii[i] > maxR) maxR = comp.radii[i];
  const nCell = Math.max(2 * maxR + pad, 1e-6);
  const nodeGrid = new Map<number, number[]>();
  const nKey = (x: number, y: number) =>
    Math.floor(y / nCell) * 1048576 + Math.floor(x / nCell);
  for (let i = 0; i < n; i++) {
    const key = nKey(comp.px[i], comp.py[i]);
    let list = nodeGrid.get(key);
    if (!list) nodeGrid.set(key, (list = []));
    list.push(i);
  }
  const wouldOverlap = (v: number, x: number, y: number): boolean => {
    const cx = Math.floor(x / nCell);
    const cy = Math.floor(y / nCell);
    for (let by = cy - 1; by <= cy + 1; by++) {
      for (let bx = cx - 1; bx <= cx + 1; bx++) {
        const list = nodeGrid.get(by * 1048576 + bx);
        if (!list) continue;
        for (const u of list) {
          if (u === v) continue;
          const rr = comp.radii[u] + comp.radii[v] + pad;
          const dx = comp.px[u] - x;
          const dy = comp.py[u] - y;
          if (dx * dx + dy * dy < rr * rr) return true;
        }
      }
    }
    return false;
  };

  const stamp = new Int32Array(m).fill(-1);
  let stampGen = 0;
  const scratchCells: number[] = [];
  /** Crossings of v's incident edges if v sat at (x,y). All edges incident to
   *  v are excluded from counting (they'd move along with v). */
  const incidentCost = (v: number, x: number, y: number): number => {
    let cost = 0;
    for (let e = comp.adjOffsets[v]; e < comp.adjOffsets[v + 1]; e++) {
      const u = comp.adjTargets[e];
      // Fresh stamp epoch PER incident edge: a foreign edge crossing two of
      // v's edges must count twice, or candidate costs are undercounted and
      // cost-increasing moves can be accepted as "improvements".
      stampGen++;
      scratchCells.length = 0;
      cellsOfSegment(grid, x, y, comp.px[u], comp.py[u], scratchCells);
      for (const c of scratchCells) {
        const list = grid.map.get(c);
        if (!list || list.length > 1024) continue; // hub-cell pile-up guard
        for (const e2 of list) {
          if (stamp[e2] === stampGen) continue;
          stamp[e2] = stampGen;
          const a2 = comp.edges[2 * e2];
          const b2 = comp.edges[2 * e2 + 1];
          // Skip edges touching v (they move with it) or sharing u.
          if (a2 === v || b2 === v || a2 === u || b2 === u) continue;
          if (
            segmentsCross(
              x, y, comp.px[u], comp.py[u],
              comp.px[a2], comp.py[a2], comp.px[b2], comp.py[b2],
            )
          ) {
            cost++;
          }
        }
      }
    }
    return cost;
  };

  let removed = 0;
  for (const v of order) {
    if (now() > deadline) break;
    const cur = incidentCost(v, comp.px[v], comp.py[v]);
    if (cur === 0) continue;
    let bestX = comp.px[v];
    let bestY = comp.py[v];
    let bestCost = cur;
    // Two shrinking-square sampling levels (Demel et al. use side·b^level).
    let outOfTime = false;
    for (const side of [3 * K, 0.8 * K]) {
      for (let t = 0; t < 12; t++) {
        // Per-candidate deadline check: one candidate is the unit of work
        // here, and a vertex can be costly even with the hub cap.
        if (now() > deadline) {
          outOfTime = true;
          break;
        }
        const x = bestX + (rng() - 0.5) * side;
        const y = bestY + (rng() - 0.5) * side;
        if (wouldOverlap(v, x, y)) continue;
        const cost = incidentCost(v, x, y);
        if (cost < bestCost) {
          bestCost = cost;
          bestX = x;
          bestY = y;
        }
      }
      if (outOfTime) break;
    }
    if (bestCost < cur) {
      // Honest grid maintenance: re-rasterize v's incident edges.
      for (const e of incident[v]) gridRemoveEdge(grid, e);
      // Move v in the node grid too.
      const oldKey = nKey(comp.px[v], comp.py[v]);
      const oldList = nodeGrid.get(oldKey);
      if (oldList) {
        const idx = oldList.indexOf(v);
        if (idx >= 0) oldList.splice(idx, 1);
      }
      comp.px[v] = bestX;
      comp.py[v] = bestY;
      const newKey = nKey(bestX, bestY);
      let newList = nodeGrid.get(newKey);
      if (!newList) nodeGrid.set(newKey, (newList = []));
      newList.push(v);
      for (const e of incident[v]) gridAddEdge(grid, comp, e);
      removed += cur - bestCost;
    }
    if (outOfTime) break;
  }
  return removed;
}
