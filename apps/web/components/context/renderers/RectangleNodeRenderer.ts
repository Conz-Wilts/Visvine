/**
 * Rectangle node renderer for Person, Investor, Event, and Resource nodes
 */

import { NBNode, getNodeGlyph } from '@/lib/types';
import { getInitials } from '@/lib/avatarUtils';
import { drawWrappedText, roundRect, drawGlyphSilhouette, withAlpha } from '../utils/canvasUtils';
import { CARD_DIMENSIONS, type NodeLOD } from '../utils/constants';
import { loadImage } from '../utils/imageCache';

/**
 * Draw a rectangle-shaped node card on canvas
 * Used for Person, Investor, Event, and Resource node types
 */
export interface CanvasTheme {
  cardBg: string;
  textPrimary: string;
  textSecondary: string;
  placeholderStart: string;
  placeholderEnd: string;
}

export function drawRectangleNode(
  ctx: CanvasRenderingContext2D,
  node: NBNode,
  x: number,
  y: number,
  lod: NodeLOD,
  isFocused: boolean,
  isConnected: boolean,
  shouldDim: boolean,
  borderColor: string,
  borderWidth: number,
  theme?: CanvasTheme
): void {
  if (typeof x !== 'number' || typeof y !== 'number') return;

  const width = CARD_DIMENSIONS.WIDTH;
  const height = CARD_DIMENSIONS.HEIGHT;
  const halfWidth = width / 2;
  const halfHeight = height / 2;

  // shadowBlur is by far the most expensive canvas op here (a gaussian blur per
  // fill). Only pay for it at full detail, or on the handful of
  // focused/connected nodes — never across a whole zoomed-out context.
  if (isFocused || isConnected) {
    // Focused/connected state: strong colored glow
    ctx.shadowColor = borderColor;
    ctx.shadowBlur = 20;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  } else if (lod === 'full' && !shouldDim) {
    // Default state: subtle colored glow
    ctx.shadowColor = borderColor;
    ctx.shadowBlur = 12;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  // Card background with rounded corners
  const radius = 8;
  const cardBg = theme?.cardBg ?? '#ffffff';
  const textPrimary = theme?.textPrimary ?? '#111827';
  const textSecondary = theme?.textSecondary ?? '#6b7280';

  ctx.fillStyle = cardBg;
  roundRect(ctx, x - halfWidth, y - halfHeight, width, height, radius);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  // Main border (colored by type)
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = borderWidth;
  roundRect(ctx, x - halfWidth, y - halfHeight, width, height, radius);
  ctx.stroke();

  // Square image area at top of card
  // Keep it inside the border by accounting for border width
  const borderOffset = borderWidth / 2;
  const headerX = x - halfWidth + borderOffset;
  const headerY = y - halfHeight + borderOffset;
  const headerWidth = width - borderWidth;
  const headerHeight = CARD_DIMENSIONS.IMAGE_HEIGHT - borderOffset;
  const imageRadius = radius - 1; // Slightly smaller radius for image corners

  // Zoomed far out: the card is a few dozen screen px — text and images are
  // unreadable. A flat colored header block keeps the silhouette recognisable
  // for a fraction of the draw cost, and skips the image fetch entirely.
  if (lod === 'low') {
    // Fill the header with rounded top corners reaching the top edge, so there's
    // no white gap above the colored block when zoomed out.
    ctx.fillStyle = borderColor;
    ctx.beginPath();
    ctx.moveTo(headerX + imageRadius, headerY);
    ctx.lineTo(headerX + headerWidth - imageRadius, headerY);
    ctx.quadraticCurveTo(headerX + headerWidth, headerY, headerX + headerWidth, headerY + imageRadius);
    ctx.lineTo(headerX + headerWidth, headerY + headerHeight);
    ctx.lineTo(headerX, headerY + headerHeight);
    ctx.lineTo(headerX, headerY + imageRadius);
    ctx.quadraticCurveTo(headerX, headerY, headerX + imageRadius, headerY);
    ctx.closePath();
    ctx.fill();
    return;
  }

  // Create clipping path for rounded top corners
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(headerX + imageRadius, headerY);
  ctx.lineTo(headerX + headerWidth - imageRadius, headerY);
  ctx.quadraticCurveTo(headerX + headerWidth, headerY, headerX + headerWidth, headerY + imageRadius);
  ctx.lineTo(headerX + headerWidth, headerY + headerHeight);
  ctx.lineTo(headerX, headerY + headerHeight);
  ctx.lineTo(headerX, headerY + imageRadius);
  ctx.quadraticCurveTo(headerX, headerY, headerX + imageRadius, headerY);
  ctx.closePath();
  ctx.clip();

  // Try to load and draw image if available
  const image = node.image_url ? loadImage(node.image_url) : null;

  if (image) {
    // Draw the image to fill the header area (object-cover style)
    const imgAspect = image.width / image.height;
    const headerAspect = headerWidth / headerHeight;

    let drawWidth: number;
    let drawHeight: number;
    let drawX: number;
    let drawY: number;

    if (imgAspect > headerAspect) {
      // Image is wider - fit by height
      drawHeight = headerHeight;
      drawWidth = headerHeight * imgAspect;
      drawX = headerX - (drawWidth - headerWidth) / 2;
      drawY = headerY;
    } else {
      // Image is taller - fit by width
      drawWidth = headerWidth;
      drawHeight = headerWidth / imgAspect;
      drawX = headerX;
      drawY = headerY - (drawHeight - headerHeight) / 2;
    }

    ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
  } else {
    // Coloured header + white type glyph when there's no image — matches the
    // org (square) card placeholder so all node types read the same. Types
    // with a glyph (person, group, event, resource) get their silhouette,
    // everything else the name initials.
    if (lod === 'full') {
      const gradient = ctx.createLinearGradient(headerX, headerY, headerX + headerWidth, headerY + headerHeight);
      gradient.addColorStop(0, withAlpha(borderColor, 0.8));
      gradient.addColorStop(1, borderColor);
      ctx.fillStyle = gradient;
    } else {
      ctx.fillStyle = borderColor;
    }
    ctx.fillRect(headerX, headerY, headerWidth, headerHeight);

    const cx = headerX + headerWidth / 2;
    const cy = headerY + headerHeight / 2;
    const glyphSize = Math.min(headerWidth, headerHeight) * 0.55;
    const glyph = getNodeGlyph(node.type);
    if (glyph) {
      drawGlyphSilhouette(ctx, glyph, cx, cy, glyphSize, '#ffffff');
    } else {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 ${Math.round(Math.min(headerWidth, headerHeight) * 0.32)}px Inter, system-ui, -apple-system`;
      ctx.fillText(getInitials(node.name ?? ''), cx, cy);
    }
  }

  ctx.restore();

  // Content - fixed font sizes that don't scale with zoom
  ctx.textBaseline = 'top';

  const nameY = headerY + CARD_DIMENSIONS.IMAGE_HEIGHT + CARD_DIMENSIONS.PADDING;
  ctx.fillStyle = textPrimary;
  ctx.font = '600 13px Inter, system-ui, -apple-system';

  // Use wrapped text for name (centered within card) and get line count
  const nameLineHeight = 16;
  const nameLines = drawWrappedText(ctx, node.name, x, nameY, width - CARD_DIMENSIONS.PADDING * 2, nameLineHeight, 'center');

  if (lod === 'full') {
    // Role / subtitle
    if (node.subtitle) {
      ctx.fillStyle = textSecondary;
      ctx.font = '400 10px Inter, system-ui, -apple-system';
      // Position subtitle dynamically based on how many lines the name used
      const subtitleY = nameY + (nameLines * nameLineHeight) + 8; // Name height + 8px gap
      drawWrappedText(ctx, node.subtitle, x, subtitleY, width - CARD_DIMENSIONS.PADDING * 2, 14, 'center');
    }

    // Role Tag — prefer the (user-entered) alias, e.g. "Founder"; fall back to
    // the node type, capitalised for display (stored types are often lowercase,
    // e.g. 'person', which would otherwise render lowercase).
    const tagsY = y + halfHeight - CARD_DIMENSIONS.PADDING - CARD_DIMENSIONS.TAG_HEIGHT;
    const roleTag =
      node.alias ?? (node.type ? node.type.charAt(0).toUpperCase() + node.type.slice(1) : node.type);
    ctx.font = '400 10px Inter, system-ui, -apple-system';

    const tagWidth = ctx.measureText(roleTag).width + 16;
    const tagX = x - tagWidth / 2; // Center the tag

    // tag background: solid type color, lightly rounded (not a full pill)
    ctx.fillStyle = borderColor;
    roundRect(ctx, tagX, tagsY, tagWidth, CARD_DIMENSIONS.TAG_HEIGHT, 6);
    ctx.fill();
    // white text on solid background
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(roleTag, tagX + tagWidth / 2, tagsY + CARD_DIMENSIONS.TAG_HEIGHT / 2);
  }
}

