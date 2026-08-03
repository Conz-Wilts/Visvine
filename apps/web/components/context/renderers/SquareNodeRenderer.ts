/**
 * Square node renderer — an image-forward rounded card used for Community
 * nodes.
 *
 * The image fills the majority of the card (a large header that spans the full
 * width), with a compact strip below holding the name and the alias chip. The
 * outer footprint stays a 260×260 rounded square (CARD_DIMENSIONS.SQUARE_SIDE) so
 * hit-testing and the collision force are unaffected — only the internal layout
 * changed from the old "small centred image + type tag" composition.
 */

import { NBNode, getNodeGlyph } from '@/lib/types';
import type { CanvasTheme } from './RectangleNodeRenderer';
import { drawWrappedText, roundRect, drawGlyphSilhouette, withAlpha } from '../utils/canvasUtils';
import { CARD_DIMENSIONS, type NodeLOD } from '../utils/constants';
import { loadImage } from '../utils/imageCache';
import { getInitials } from '@/lib/avatarUtils';

// Stored node types are often lowercase ('person'); capitalise for display.
function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

// Corner radius for the alias/type chip — small, not a full pill.
const CHIP_RADIUS = 6;

/**
 * Draw an image-forward rounded card on canvas. Used for the Community node
 * type: a square image fills the width, with a name + alias-chip caption strip
 * below.
 */
export function drawSquareNode(
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

  // Square image (full width) + caption strip below → a gentle portrait card.
  const width = CARD_DIMENSIONS.SQUARE_SIDE;
  const height = CARD_DIMENSIONS.SQUARE_SIDE + CARD_DIMENSIONS.SQUARE_CAPTION;
  const halfW = width / 2;
  const halfH = height / 2;
  const left = x - halfW;
  const top = y - halfH;
  const outerRadius = 24;

  // shadowBlur only at full detail or on focused/connected nodes — it's the
  // most expensive canvas op and invisible at zoomed-out sizes.
  if (isFocused || isConnected) {
    ctx.shadowColor = borderColor;
    ctx.shadowBlur = 20;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  } else if (lod === 'full' && !shouldDim) {
    ctx.shadowColor = borderColor;
    ctx.shadowBlur = 12;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  const cardBg = theme?.cardBg ?? '#ffffff';
  const textPrimary = theme?.textPrimary ?? '#111827';

  // Card background
  ctx.fillStyle = cardBg;
  roundRect(ctx, left, top, width, height, outerRadius);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  // Main border (colored by type/alias)
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = borderWidth;
  roundRect(ctx, left, top, width, height, outerRadius);
  ctx.stroke();

  // Image header — full width and SQUARE (height === width), at the top.
  const borderOffset = borderWidth / 2;
  const headerX = left + borderOffset;
  const headerY = top + borderOffset;
  const headerWidth = width - borderWidth;
  const headerHeight = headerWidth;
  const imageRadius = outerRadius - 2;

  // Header path: rounded top corners (matching the card), square bottom where it
  // meets the caption. Reused for the low-LOD fill and the full clip so the
  // colored block reaches the top edge — no white gap above it when zoomed out.
  const traceHeader = () => {
    ctx.beginPath();
    ctx.moveTo(headerX + imageRadius, headerY);
    ctx.lineTo(headerX + headerWidth - imageRadius, headerY);
    ctx.quadraticCurveTo(headerX + headerWidth, headerY, headerX + headerWidth, headerY + imageRadius);
    ctx.lineTo(headerX + headerWidth, headerY + headerHeight);
    ctx.lineTo(headerX, headerY + headerHeight);
    ctx.lineTo(headerX, headerY + imageRadius);
    ctx.quadraticCurveTo(headerX, headerY, headerX + imageRadius, headerY);
    ctx.closePath();
  };

  // Zoomed far out: a flat colored header keeps the silhouette readable without
  // image fetches or text.
  if (lod === 'low') {
    ctx.fillStyle = borderColor;
    traceHeader();
    ctx.fill();
    return;
  }

  // Clip to the header so the image fills it with rounded top corners.
  ctx.save();
  traceHeader();
  ctx.clip();

  const image = node.image_url ? loadImage(node.image_url) : null;

  if (image) {
    // Object-cover the image into the header area.
    const imgAspect = image.width / image.height;
    const headerAspect = headerWidth / headerHeight;
    let drawWidth: number;
    let drawHeight: number;
    let drawX: number;
    let drawY: number;

    if (imgAspect > headerAspect) {
      drawHeight = headerHeight;
      drawWidth = headerHeight * imgAspect;
      drawX = headerX - (drawWidth - headerWidth) / 2;
      drawY = headerY;
    } else {
      drawWidth = headerWidth;
      drawHeight = headerWidth / imgAspect;
      drawX = headerX;
      drawY = headerY - (drawHeight - headerHeight) / 2;
    }

    ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
  } else {
    // Coloured placeholder + initials when there's no image.
    if (lod === 'full') {
      const gradient = ctx.createLinearGradient(headerX, headerY, headerX + headerWidth, headerY + headerHeight);
      gradient.addColorStop(0, withAlpha(borderColor, 0.8));
      gradient.addColorStop(1, borderColor);
      ctx.fillStyle = gradient;
    } else {
      ctx.fillStyle = borderColor;
    }
    ctx.fillRect(headerX, headerY, headerWidth, headerHeight);

    // White type glyph on the coloured header; fall back to name initials.
    const cx = headerX + headerWidth / 2;
    const cy = headerY + headerHeight / 2;
    const glyph = getNodeGlyph(node.type);
    if (glyph) {
      drawGlyphSilhouette(ctx, glyph, cx, cy, headerHeight * 0.6, '#ffffff');
    } else {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 ${Math.round(headerHeight * 0.32)}px Inter, system-ui, -apple-system`;
      ctx.fillText(getInitials(node.name ?? ''), cx, cy);
    }
  }

  ctx.restore();

  // ── Caption strip: name + alias chip, vertically centred under the image so
  //    short names don't leave dead space that stretches the card. ────────────
  const maxTextWidth = width - 40;
  // Prefer the (user-entered) alias; fall back to the capitalised type.
  const chipLabel = node.alias ?? capitalize(node.type);
  const hasChip = lod === 'full' && !!chipLabel;

  ctx.font = '600 15px Inter, system-ui, -apple-system';
  const nameLineHeight = 19;
  const nameLines = ctx.measureText(node.name).width <= maxTextWidth ? 1 : 2;
  const chipHeight = 22;
  const chipGap = 9;
  const blockHeight = nameLines * nameLineHeight + (hasChip ? chipGap + chipHeight : 0);

  const headerBottom = headerY + headerHeight;
  const regionHeight = top + height - headerBottom;
  let cursorY = headerBottom + (regionHeight - blockHeight) / 2;

  // Name
  ctx.fillStyle = textPrimary;
  ctx.textBaseline = 'top';
  drawWrappedText(ctx, node.name, x, cursorY, maxTextWidth, nameLineHeight, 'center');
  cursorY += nameLines * nameLineHeight;

  if (!hasChip) return;

  // Alias chip (prefer the alias, e.g. "Portfolio Company"; fall back to the type)
  cursorY += chipGap;
  const chipPadX = 14;
  ctx.font = '600 12px Inter, system-ui, -apple-system';
  const chipWidth = ctx.measureText(chipLabel).width + chipPadX * 2;
  const chipX = x - chipWidth / 2;

  ctx.fillStyle = borderColor;
  roundRect(ctx, chipX, cursorY, chipWidth, chipHeight, CHIP_RADIUS);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(chipLabel, x, cursorY + chipHeight / 2);
}
