/**
 * Graph rendering constants
 */

/**
 * Card dimensions for node rendering
 * 4:3 aspect ratio image area (140px × 105px) with content below
 * Image takes ~40% of card height, leaving room for name, subtitle, and tag
 */
export const CARD_DIMENSIONS = {
  WIDTH: 140,
  HEIGHT: 215,
  SIMPLIFIED_HEIGHT: 90,
  IMAGE_HEIGHT: 105,
  BORDER_WIDTH: 4,
  PADDING: 12,
  TAG_HEIGHT: 20,
} as const;

// Obsidian Graph View defaults (centerStrength 0.5, repelStrength 10,
// linkStrength 1.0, linkDistance ~250) scaled to fit 140×215 cards. Mirrors
// the ratios in real .obsidian/graph.json files; tuned for breathing room
// rather than a tight uniform mesh.
export const OBSIDIAN_PHYSICS = {
  centerStrength: 0.025,
  chargeStrength: -4200,
  chargeDistanceMin: 60,
  chargeDistanceMax: 4500,
  linkDistance: 800,
  linkStrength: 0.4,
  alpha: 1,
  alphaDecay: 0.018,
  alphaMin: 0.001,
  velocityDecay: 0.32,
  seedRadius: 90,
  fadeInDurationMs: 700,
  fadeInStaggerMs: 8,
  // Each node eases up by this many graph-units as it fades in, so nodes "rise"
  // into place. Applied visually in the canvas transform only — node positions
  // (and the persisted layout) are never moved.
  fadeInRiseY: 26,
  isolatedRingMultiplier: 2.6,
  isolatedRingStrength: 0.3,
  ticksBeforeReveal: 6,
  rectCollideGap: 120,
  rectCollideStrength: 0.45,
} as const;

