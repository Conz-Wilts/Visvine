// Barnes-Hut quadtree over a component's current positions, backing the
// long-range repulsion approximation in the force stage.

import type { Rng } from './types';

/**
 * Flat-array quadtree shared by Barnes-Hut repulsion and collision passes.
 *
 * Storage: cell c owns children[4c..4c+3]; a slot holds -1 (empty), a cell
 * index (≥0), or an encoded leaf -(nodeIndex+2). Cells are created in
 * top-down order, so child index > parent index always — which lets the
 * mass/center-of-mass/max-radius aggregation run as a single reverse-order
 * sweep instead of an explicit post-order traversal.
 */
export const QT_EMPTY = -1;
export const QT_MAX_DEPTH = 32;

export interface Quadtree {
  children: Int32Array;
  cx: Float64Array;
  cy: Float64Array;
  half: Float64Array;
  mass: Float64Array;
  comX: Float64Array;
  comY: Float64Array;
  maxR: Float64Array;
  count: number;
}

export function buildQuadtree(
  n: number,
  px: Float64Array,
  py: Float64Array,
  radii: Float64Array,
  nodeMass: Float64Array,
  rng: Rng,
  K: number,
): Quadtree {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    if (px[i] < minX) minX = px[i];
    if (px[i] > maxX) maxX = px[i];
    if (py[i] < minY) minY = py[i];
    if (py[i] > maxY) maxY = py[i];
  }
  const side = Math.max(maxX - minX, maxY - minY, 1e-6) * 1.0001;
  const rootCx = (minX + maxX) / 2;
  const rootCy = (minY + maxY) / 2;

  let cap = Math.max(64, 2 * n);
  let children = new Int32Array(cap * 4).fill(QT_EMPTY);
  let cx = new Float64Array(cap);
  let cy = new Float64Array(cap);
  let half = new Float64Array(cap);
  let count = 0;

  const newCell = (x: number, y: number, h: number): number => {
    if (count === cap) {
      cap *= 2;
      const c2 = new Int32Array(cap * 4).fill(QT_EMPTY);
      c2.set(children);
      children = c2;
      const grow = (a: Float64Array) => {
        const b = new Float64Array(cap);
        b.set(a);
        return b;
      };
      cx = grow(cx);
      cy = grow(cy);
      half = grow(half);
    }
    const c = count++;
    cx[c] = x;
    cy[c] = y;
    half[c] = h;
    return c;
  };
  newCell(rootCx, rootCy, side / 2);

  for (let i = 0; i < n; i++) {
    // Any non-finite coordinate (defensive: shouldn't occur after input
    // validation) would spin the insert loop forever — reset it instead.
    if (!Number.isFinite(px[i]) || !Number.isFinite(py[i])) {
      px[i] = rootCx + (rng() - 0.5) * side;
      py[i] = rootCy + (rng() - 0.5) * side;
    }
    let jitter = Math.max(1e-4 * K, 1e-9);
    // Insertion with jiggle-and-restart on coincident points / depth overflow.
    insert: for (;;) {
      let c = 0;
      let depth = 0;
      for (;;) {
        const q = (px[i] >= cx[c] ? 1 : 0) | (py[i] >= cy[c] ? 2 : 0);
        const slot = 4 * c + q;
        const v = children[slot];
        if (v === QT_EMPTY) {
          children[slot] = -(i + 2);
          break insert;
        }
        if (v >= 0) {
          c = v;
          depth++;
          continue;
        }
        const j = -v - 2;
        if (
          depth >= QT_MAX_DEPTH ||
          (px[i] === px[j] && py[i] === py[j])
        ) {
          px[i] += (rng() - 0.5) * jitter;
          py[i] += (rng() - 0.5) * jitter;
          jitter *= 4;
          continue insert; // restart from the root with the nudged point
        }
        // Split: push existing leaf j one level down, then retry placing i.
        const h2 = half[c] / 2;
        const ncx = cx[c] + ((q & 1) ? h2 : -h2);
        const ncy = cy[c] + ((q & 2) ? h2 : -h2);
        const nc = newCell(ncx, ncy, h2);
        children[slot] = nc;
        const qj = (px[j] >= ncx ? 1 : 0) | (py[j] >= ncy ? 2 : 0);
        children[4 * nc + qj] = -(j + 2);
        c = nc;
        depth++;
      }
    }
  }

  // Bottom-up aggregation via reverse index order (children > parents).
  const mass = new Float64Array(count);
  const comX = new Float64Array(count);
  const comY = new Float64Array(count);
  const maxR = new Float64Array(count);
  for (let c = count - 1; c >= 0; c--) {
    let m = 0;
    let sx = 0;
    let sy = 0;
    let mr = 0;
    for (let q = 0; q < 4; q++) {
      const v = children[4 * c + q];
      if (v === QT_EMPTY) continue;
      if (v < QT_EMPTY) {
        const j = -v - 2;
        const mj = nodeMass[j];
        m += mj;
        sx += mj * px[j];
        sy += mj * py[j];
        if (radii[j] > mr) mr = radii[j];
      } else {
        m += mass[v];
        sx += mass[v] * comX[v];
        sy += mass[v] * comY[v];
        if (maxR[v] > mr) mr = maxR[v];
      }
    }
    mass[c] = m;
    comX[c] = m > 0 ? sx / m : cx[c];
    comY[c] = m > 0 ? sy / m : cy[c];
    maxR[c] = mr;
  }
  return { children, cx, cy, half, mass, comX, comY, maxR, count };
}
