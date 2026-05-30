/**
 * Point-in-hexagon test via ray casting, for a hexagon centred at (cx, cy) with
 * circumradius `radius` (same vertex layout the hexagon renderer uses).
 * Pure geometry extracted from CustomForceGraph.
 */
export function isPointInHexagon(
  px: number,
  py: number,
  cx: number,
  cy: number,
  radius: number,
): boolean {
  const vertices: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 3;
    vertices.push({
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  }

  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].x;
    const yi = vertices[i].y;
    const xj = vertices[j].x;
    const yj = vertices[j].y;

    const intersect = ((yi > py) !== (yj > py)) &&
      (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
