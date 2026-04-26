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

