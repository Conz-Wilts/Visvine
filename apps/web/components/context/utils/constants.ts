/**
 * Context rendering constants
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
  // Community card: a SQUARE image (side = SQUARE_SIDE, full width)
  // plus a caption strip below for the name + alias chip. So the card itself is a
  // gentle portrait rectangle (SQUARE_SIDE wide × SQUARE_SIDE + SQUARE_CAPTION
  // tall) — taller than wide, but less elongated than the 140×215 rectangle cards.
  SQUARE_SIDE: 192,
  SQUARE_CAPTION: 76,
} as const;

/**
 * Zoom-based level of detail for node cards. On-screen card width is
 * `transform.k × CARD_DIMENSIONS.WIDTH`, so the thresholds below translate to
 * roughly 77px and 31px of on-screen width.
 *
 *  - full: everything — image (fetched on demand), name, subtitle, type tag, glow.
 *  - mid:  image + name only; no shadow/glow, no gradient placeholders.
 *  - low:  flat colored card silhouette; no text, no image, no shadow. This is
 *          what makes a fully zoomed-out context cheap to pan.
 */
export type NodeLOD = 'full' | 'mid' | 'low';

export const LOD_THRESHOLDS = {
  FULL_MIN_K: 0.55,
  MID_MIN_K: 0.22,
} as const;

// Obsidian Context View defaults (centerStrength 0.5, repelStrength 10,
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
  // Cap on the total stagger window. Without it the fade-in render pump runs
  // for nodes.length × fadeInStaggerMs (8s+ on a 1000-node community), doing a
  // full-canvas redraw every frame the whole time. spawnIndex values are
  // compressed at stamp time so the last node still starts fading by this cap.
  fadeInMaxTotalStaggerMs: 1500,
  // Each node eases up by this many context-units as it fades in, so nodes "rise"
  // into place. Applied visually in the canvas transform only — node positions
  // (and the persisted layout) are never moved.
  fadeInRiseY: 26,
  isolatedRingMultiplier: 2.6,
  isolatedRingStrength: 0.3,
  ticksBeforeReveal: 6,
  rectCollideGap: 120,
  rectCollideStrength: 0.45,
} as const;


