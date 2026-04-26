/**
 * Hexagon node renderer for Organization and Startup nodes
 */

import { NBNode } from '@/lib/types';
import type { CanvasTheme } from './RectangleNodeRenderer';
import { drawWrappedText, roundRect, drawHexagon } from '../utils/canvasUtils';
import { CARD_DIMENSIONS } from '../utils/constants';
import { loadImage } from '../utils/imageCache';

/**
 * Draw a hexagon-shaped node on canvas
 * Used for Organization and Startup node types
 */
export function drawHexagonNode(
  ctx: CanvasRenderingContext2D,
  node: NBNode,
  x: number,
  y: number,
  simplified: boolean,
  isFocused: boolean,
  isConnected: boolean,
  shouldDim: boolean,
  borderColor: string,
  borderWidth: number,
  theme?: CanvasTheme
): void {
  if (typeof x !== 'number' || typeof y !== 'number') return;

  const width = CARD_DIMENSIONS.WIDTH;
  const height = simplified ? CARD_DIMENSIONS.SIMPLIFIED_HEIGHT : CARD_DIMENSIONS.HEIGHT;
  
  // Hexagon shape for organizations and companies - make them larger
  const hexRadius = Math.max(width, height) * 0.75;

  // Configure shadow based on state
  if (shouldDim) {
    // Dimmed state: no glow, just subtle drop shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.05)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;
  } else if (isFocused || isConnected) {
    // Focused/connected state: strong colored glow
    ctx.shadowColor = borderColor;
    ctx.shadowBlur = 20;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  } else {
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
  const placeholderStart = theme?.placeholderStart ?? '#e5e7eb';
  const placeholderEnd = theme?.placeholderEnd ?? '#f3f4f6';

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
    // Draw gradient placeholder if no image
    const imageGradient = ctx.createLinearGradient(imageX, imageY, imageX, imageY + imageSize);
    imageGradient.addColorStop(0, placeholderStart);
    imageGradient.addColorStop(1, placeholderEnd);
    ctx.fillStyle = imageGradient;

    // Draw rounded square
    roundRect(ctx, imageX, imageY, imageSize, imageSize, squareRadius);
    ctx.fill();

    ctx.strokeStyle = borderColor;
    ctx.lineWidth = borderWidth * 0.6;
    roundRect(ctx, imageX, imageY, imageSize, imageSize, squareRadius);
    ctx.stroke();
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

