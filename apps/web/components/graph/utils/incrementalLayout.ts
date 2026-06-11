/**
 * Incremental layout: reuse a saved layout whose structure hash no longer
 * matches (members joined/left, links changed) instead of throwing it away and
 * re-running the full layout engine (~1.5s of main-thread work).
 *
 * Nodes that already have a saved position keep it; new nodes are placed near
 * the centroid of their already-placed neighbours (or on the periphery when
 * isolated), with a deterministic spiral probe guaranteeing they don't overlap
 * anything already placed.
 */

import { CARD_DIMENSIONS } from './constants';

export interface Point {
  x: number;
  y: number;
}

// Two card centres at least this far apart can never overlap regardless of
// direction: overlap requires |dx| < W and |dy| < H, whose max distance is
// hypot(W, H) ≈ 257.
const MIN_DIST = Math.hypot(CARD_DIMENSIONS.WIDTH, CARD_DIMENSIONS.HEIGHT) + 24;
const CELL = MIN_DIST;
const GOLDEN_ANGLE = 2.39996322972865332; // radians

function cellKey(x: number, y: number): string {
  return `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
}

/** Deterministic per-node angle so placement is stable across loads. */
function hashAngle(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((h >>> 0) % 3600) / 3600 * Math.PI * 2;
}

class SpatialIndex {
  private cells = new Map<string, Point[]>();

  add(p: Point): void {
    const key = cellKey(p.x, p.y);
    const bucket = this.cells.get(key);
    if (bucket) bucket.push(p);
    else this.cells.set(key, [p]);
  }

  isFree(p: Point): boolean {
    const cx = Math.floor(p.x / CELL);
    const cy = Math.floor(p.y / CELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = this.cells.get(`${cx + dx},${cy + dy}`);
        if (!bucket) continue;
        for (const q of bucket) {
          if (Math.hypot(p.x - q.x, p.y - q.y) < MIN_DIST) return false;
        }
      }
    }
    return true;
  }
}

/** Spiral outward from `desired` until a collision-free spot is found. */
function findFreeSpot(desired: Point, startAngle: number, index: SpatialIndex): Point {
  if (index.isFree(desired)) return desired;
  for (let i = 1; i < 600; i++) {
    const a = startAngle + i * GOLDEN_ANGLE;
    const r = CELL * 0.6 * Math.sqrt(i);
    const candidate = { x: desired.x + r * Math.cos(a), y: desired.y + r * Math.sin(a) };
    if (index.isFree(candidate)) return candidate;
  }
  // Pathological fallback — push far out along the start angle.
  return { x: desired.x + CELL * 16 * Math.cos(startAngle), y: desired.y + CELL * 16 * Math.sin(startAngle) };
}

/**
 * Build positions for `nodeIds` from a partially matching `saved` layout.
 * Returns null when coverage is too low for reuse to look reasonable —
 * caller should fall back to the full layout engine.
 */
export function placeIncrementally(
  nodeIds: string[],
  links: Array<{ source: string; target: string }>,
  saved: Record<string, Point>,
  minCoverage = 0.7,
): Map<string, Point> | null {
  if (nodeIds.length === 0) return null;

  const known: string[] = [];
  const unknown: string[] = [];
  for (const id of nodeIds) {
    if (saved[id]) known.push(id);
    else unknown.push(id);
  }
  if (known.length / nodeIds.length < minCoverage) return null;

  const out = new Map<string, Point>();
  const index = new SpatialIndex();

  let cx = 0, cy = 0, maxR = 0;
  for (const id of known) {
    const p = { x: saved[id].x, y: saved[id].y };
    out.set(id, p);
    index.add(p);
    cx += p.x;
    cy += p.y;
  }
  cx /= known.length;
  cy /= known.length;
  for (const id of known) {
    maxR = Math.max(maxR, Math.hypot(saved[id].x - cx, saved[id].y - cy));
  }

  if (unknown.length === 0) return out;

  const adjacency = new Map<string, string[]>();
  const addEdge = (a: string, b: string) => {
    const list = adjacency.get(a);
    if (list) list.push(b);
    else adjacency.set(a, [b]);
  };
  for (const l of links) {
    addEdge(l.source, l.target);
    addEdge(l.target, l.source);
  }

  for (const id of unknown) {
    const angle = hashAngle(id);
    const placedNeighbors = (adjacency.get(id) ?? [])
      .map(n => out.get(n))
      .filter((p): p is Point => !!p);

    let desired: Point;
    if (placedNeighbors.length > 0) {
      desired = {
        x: placedNeighbors.reduce((s, p) => s + p.x, 0) / placedNeighbors.length,
        y: placedNeighbors.reduce((s, p) => s + p.y, 0) / placedNeighbors.length,
      };
    } else {
      // Isolated / all-new neighbourhood: ring just outside the existing cloud.
      const r = maxR + CELL * 1.5;
      desired = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    }

    const p = findFreeSpot(desired, angle, index);
    out.set(id, p);
    index.add(p);
  }

  return out;
}
