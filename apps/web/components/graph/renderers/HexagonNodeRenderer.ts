/**
 * Hexagon node renderer for Organization and Startup nodes
 */

import { NBNode } from '@/lib/types';
import type { CanvasTheme } from './RectangleNodeRenderer';
import { drawWrappedText, roundRect, drawHexagon } from '../utils/canvasUtils';
import { CARD_DIMENSIONS, type NodeLOD } from '../utils/constants';
import { loadImage } from '../utils/imageCache';
import { getInitials } from '@/lib/avatarUtils';

function withAlpha(hex: string, alpha: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  return hex + Math.round(alpha * 255).toString(16).padStart(2, '0');
}

/**
 * Draw a hexagon-shaped node on canvas
 * Used for Organization and Startup node types
 */
export function drawHexagonNode(
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

  // Hexagon shape for organizations and companies - make them larger
  const hexRadius = Math.max(width, height) * 0.75;

  // shadowBlur only at full detail or on focused/connected nodes — it's the
  // most expensive canvas op and invisible at zoomed-out card sizes.
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

  // Draw hexagon background
  const cardBg = theme?.cardBg ?? '#ffffff';
  const textPrimary = theme?.textPrimary ?? '#111827';
  const textSecondary = theme?.textSecondary ?? '#6b7280';

  ctx.fillStyle = cardBg;
  drawHexagon(ctx, x, y, hexRadius);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  // Main border (colored by type)
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = borderWidth;
  drawHexagon(ctx, x, y, hexRadius);
  ctx.stroke();

  // Image area for hexagon (square inset)
  const imageSize = hexRadius * 0.8;
  const imageX = x - imageSize / 2;
  const imageY = y - hexRadius * 0.4 - imageSize / 2;
  const squareRadius = 8;

  // Zoomed far out: flat colored inset keeps the silhouette readable without
  // image fetches, gradients, or text.
  if (lod === 'low') {
    ctx.fillStyle = borderColor;
    roundRect(ctx, imageX, imageY, imageSize, imageSize, squareRadius);
    ctx.fill();
    return;
  }

  // Try to load and draw image if available
  const image = node.image_url ? loadImage(node.image_url) : null;

  if (image) {
    // Create clipping path for rounded square
    ctx.save();
    roundRect(ctx, imageX, imageY, imageSize, imageSize, squareRadius);
    ctx.clip();

    // Draw the image to fill the square area (object-cover style)
    const imgAspect = image.width / image.height;

    let drawWidth: number;
    let drawHeight: number;
    let drawX: number;
    let drawY: number;

    if (imgAspect > 1) {
      // Image is wider - fit by height
      drawHeight = imageSize;
      drawWidth = imageSize * imgAspect;
      drawX = imageX - (drawWidth - imageSize) / 2;
      drawY = imageY;
    } else {
      // Image is taller - fit by width
      drawWidth = imageSize;
      drawHeight = imageSize / imgAspect;
      drawX = imageX;
      drawY = imageY - (drawHeight - imageSize) / 2;
    }

    ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
    ctx.restore();

    // Draw border around image
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = borderWidth * 0.6;
    roundRect(ctx, imageX, imageY, imageSize, imageSize, squareRadius);
    ctx.stroke();
  } else {
    // Coloured placeholder + initials when there's no image
    if (lod === 'full') {
      const imageGradient = ctx.createLinearGradient(imageX, imageY, imageX + imageSize, imageY + imageSize);
      imageGradient.addColorStop(0, withAlpha(borderColor, 0.8));
      imageGradient.addColorStop(1, borderColor);
      ctx.fillStyle = imageGradient;
    } else {
      ctx.fillStyle = borderColor;
    }

    roundRect(ctx, imageX, imageY, imageSize, imageSize, squareRadius);
    ctx.fill();

    ctx.strokeStyle = borderColor;
    ctx.lineWidth = borderWidth * 0.6;
    roundRect(ctx, imageX, imageY, imageSize, imageSize, squareRadius);
    ctx.stroke();

    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${Math.round(imageSize * 0.4)}px Inter, system-ui, -apple-system`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      getInitials(node.name ?? ''),
      imageX + imageSize / 2,
      imageY + imageSize / 2
    );
    ctx.restore();
  }

  // Content layout
  ctx.textBaseline = 'top';

  // Primary text (name) - positioned below the image
  const nameY = imageY + imageSize + 12;
  ctx.fillStyle = textPrimary;
  ctx.font = '600 12px Inter, system-ui, -apple-system';
  const nameLineHeight = 15;
  const maxTextWidth = hexRadius * 1.3;
  const nameLines = drawWrappedText(ctx, node.name, x, nameY, maxTextWidth, nameLineHeight, 'center');

  // Subtitle + type tag are full-detail only.
  if (lod !== 'full') return;

  // Secondary text (subtitle) - positioned below name
  if (node.subtitle) {
    ctx.fillStyle = textSecondary;
    ctx.font = '400 10px Inter, system-ui, -apple-system';
    const subtitleY = nameY + (nameLines * nameLineHeight) + 6;
    drawWrappedText(ctx, node.subtitle, x, subtitleY, maxTextWidth, 12, 'center');
  }

  // Identity tag at bottom
  const tagY = y + hexRadius * 0.7;
  const roleTag = node.type;
  ctx.font = '400 10px Inter, system-ui, -apple-system';

  const tagWidth = ctx.measureText(roleTag).width + 16;
  const tagX = x - tagWidth / 2;
  const tagHeight = 18;

  // pill background: solid type color
  ctx.fillStyle = borderColor;
  roundRect(ctx, tagX, tagY, tagWidth, tagHeight, 9);
  ctx.fill();

  // white text on solid background
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(roleTag, x, tagY + tagHeight / 2);
}

