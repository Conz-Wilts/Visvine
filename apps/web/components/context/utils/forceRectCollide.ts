/**
 * Card-aware rectangular collision force for d3-force.
 *
 * Charge does most of the spacing work; this just guarantees cards never
 * overlap. A uniform spatial hash keeps each tick ~O(n) instead of O(n²).
 *
 * Extracted verbatim from ContextCanvas and kept generic over the minimal
 * mutable node shape d3 mutates, so it has no dependency back on the component.
 */

export interface RectCollideNode {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  index?: number;
}

export interface RectCollideParams {
  /** Half card width + half the desired inter-card gap. */
  halfW: number;
  /** Half card height + half the desired inter-card gap. */
  halfH: number;
  /** Fraction of each overlap resolved per iteration (0–1). */
  strength: number;
  /** Relaxation passes per tick. */
  iterations: number;
  /** Spatial-hash cell size (≈ 2.5× the larger half-extent). */
  cellSize: number;
}

export function createRectCollideForce<N extends RectCollideNode>(
  { halfW, halfH, strength, iterations, cellSize }: RectCollideParams,
) {
  let nodeArray: N[] = [];

  function force() {
    for (let iter = 0; iter < iterations; iter++) {
      const grid = new Map<string, N[]>();
      for (let i = 0; i < nodeArray.length; i++) {
        const node = nodeArray[i];
        if (typeof node.x !== 'number' || typeof node.y !== 'number') continue;
        const key = `${Math.floor(node.x / cellSize)},${Math.floor(node.y / cellSize)}`;
        const cell = grid.get(key);
        if (cell) cell.push(node); else grid.set(key, [node]);
      }

      for (let i = 0; i < nodeArray.length; i++) {
        const a = nodeArray[i];
        if (typeof a.x !== 'number' || typeof a.y !== 'number') continue;
        const gx = Math.floor(a.x / cellSize);
        const gy = Math.floor(a.y / cellSize);

        for (let ox = -1; ox <= 1; ox++) {
          for (let oy = -1; oy <= 1; oy++) {
            const cell = grid.get(`${gx + ox},${gy + oy}`);
            if (!cell) continue;
            for (let ci = 0; ci < cell.length; ci++) {
              const b = cell[ci];
              if (b === a || (b.index !== undefined && a.index !== undefined && b.index <= a.index)) continue;
              if (typeof b.x !== 'number' || typeof b.y !== 'number') continue;

              const dx = b.x - a.x;
              const dy = b.y - a.y;
              const overlapX = halfW * 2 - Math.abs(dx);
              const overlapY = halfH * 2 - Math.abs(dy);
              if (overlapX <= 0 || overlapY <= 0) continue;

              let pushX = 0, pushY = 0;
              if (overlapX < overlapY) {
                pushX = (overlapX / 2) * strength * Math.sign(dx || 1);
              } else {
                pushY = (overlapY / 2) * strength * Math.sign(dy || 1);
              }

              a.x! -= pushX; a.y! -= pushY;
              b.x! += pushX; b.y! += pushY;
              if (a.vx !== undefined) a.vx -= pushX * 0.3;
              if (a.vy !== undefined) a.vy -= pushY * 0.3;
              if (b.vx !== undefined) b.vx += pushX * 0.3;
              if (b.vy !== undefined) b.vy += pushY * 0.3;
            }
          }
        }
      }
    }
  }

  force.initialize = (n: N[]) => { nodeArray = n; };
  return force;
}
