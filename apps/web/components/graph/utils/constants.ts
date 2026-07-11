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
  // Organization/Community card: a SQUARE image (side = SQUARE_SIDE, full width)
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
 *          what makes a fully zoomed-out graph cheap to pan.
 */
export type NodeLOD = 'full' | 'mid' | 'low';

export const LOD_THRESHOLDS = {
  FULL_MIN_K: 0.55,
  MID_MIN_K: 0.22,
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
  // Cap on the total stagger window. Without it the fade-in render pump runs
  // for nodes.length × fadeInStaggerMs (8s+ on a 1000-node community), doing a
  // full-canvas redraw every frame the whole time. spawnIndex values are
  // compressed at stamp time so the last node still starts fading by this cap.
  fadeInMaxTotalStaggerMs: 1500,
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

// Obsidian Graph View physics + presentation at true dot scale (4–12px circles,
// not 140×215 cards — OBSIDIAN_PHYSICS above is the same shape scaled ~20× for
// card geometry). Used by the notes graph (features/notes/NotesGraph).
export const NOTES_GRAPH = {
  // Forces
  linkDistance: 60,
  linkStrength: 0.6,
  chargeStrength: -120,
  chargeDistanceMax: 600,
  centerStrength: 0.03, // forceX/forceY soft pull toward origin
  collidePadding: 2, // forceCollide radius = node radius + this
  alpha: 0.6, // seeded layout only needs a short "breathe into place"
  alphaDecay: 0.0228,
  alphaMin: 0.001,
  velocityDecay: 0.35,
  dragAlphaTarget: 0.3, // sim reheat while a node is being dragged
  ticksBeforeReveal: 6,
  // Node sizing: r = min(maxRadius, minRadius + sqrt(degree) * 1.5)
  minRadius: 4,
  maxRadius: 12,
  // Labels fade in with zoom, relative to the fitted overview zoom: invisible
  // at the fit, fading in from fitK × start-factor to fully opaque at
  // fitK × end-factor (both capped by the absolute Ks so labels always appear
  // by then on tiny graphs). Font size is screen-constant (divided by zoom k).
  labelFadeStartFitFactor: 1.35,
  labelFadeEndFitFactor: 2.2,
  labelFadeStartMaxK: 2.0,
  labelFadeEndMaxK: 3.2,
  labelFontSize: 11,
  labelOffsetY: 6, // screen px below the dot's edge
  // Hover highlight: hovered node + neighbors stay lit, the rest fades to the
  // dimmed alphas over hoverTransitionMs (and back on leave).
  hoverTransitionMs: 200,
  dimmedNodeAlpha: 0.12,
  dimmedLinkAlpha: 0.04,
  highlightLinkAlpha: 0.9,
  baseLinkAlpha: 0.25,
  baseLinkWidth: 1, // screen px (divided by zoom k, floored at 0.3)
  hoverScale: 1.25, // hovered dot grows to this multiple
  hoverHitPadding: 6, // screen px of extra hit-test slop around a dot
  clickSlopPx: 5, // press+release within this = click, beyond = drag
} as const;

