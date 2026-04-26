/**
 * Rectangle node renderer for Person, Investor, Event, and Group nodes
 */

import { NBNode } from '@/lib/types';
import { drawWrappedText, roundRect } from '../utils/canvasUtils';
import { CARD_DIMENSIONS } from '../utils/constants';
import { loadImage } from '../utils/imageCache';

/**
 * Draw a rectangle-shaped node card on canvas
 * Used for Person, Investor, Event, and Group node types
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
  const halfWidth = width / 2;
  const halfHeight = height / 2;

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

  // Card background with rounded corners
  const radius = 8;
  const cardBg = theme?.cardBg ?? '#ffffff';
  const textPrimary = theme?.textPrimary ?? '#111827';
  const textSecondary = theme?.textSecondary ?? '#6b7280';
  const placeholderStart = theme?.placeholderStart ?? '#e5e7eb';
  const placeholderEnd = theme?.placeholderEnd ?? '#f3f4f6';

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
    // Draw gradient placeholder if no image
    const headerGradient = ctx.createLinearGradient(0, headerY, 0, headerY + headerHeight);
    headerGradient.addColorStop(0, placeholderStart);
    headerGradient.addColorStop(1, placeholderEnd);
    ctx.fillStyle = headerGradient;
    ctx.fillRect(headerX, headerY, headerWidth, headerHeight);
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

  if (!simplified) {
    // Role / subtitle
    if (node.subtitle) {
      ctx.fillStyle = textSecondary;
      ctx.font = '400 10px Inter, system-ui, -apple-system';
      // Position subtitle dynamically based on how many lines the name used
      const subtitleY = nameY + (nameLines * nameLineHeight) + 8; // Name height + 8px gap
      drawWrappedText(ctx, node.subtitle, x, subtitleY, width - CARD_DIMENSIONS.PADDING * 2, 14, 'center');
    }

    // Role Tag - only show the node type with its color
    const tagsY = y + halfHeight - CARD_DIMENSIONS.PADDING - CARD_DIMENSIONS.TAG_HEIGHT;
    const roleTag = node.type;
    ctx.font = '400 10px Inter, system-ui, -apple-system';

    const tagWidth = ctx.measureText(roleTag).width + 16;
    const tagX = x - tagWidth / 2; // Center the tag

    // pill background: solid type color
    ctx.fillStyle = borderColor;
    roundRect(ctx, tagX, tagsY, tagWidth, CARD_DIMENSIONS.TAG_HEIGHT, 9);
    ctx.fill();
    // white text on solid background
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(roleTag, tagX + tagWidth / 2, tagsY + CARD_DIMENSIONS.TAG_HEIGHT / 2);
  }
}

