/**
 * Circle node renderer for circular node types
 */

import { NBNode } from '@/lib/types';
import type { CanvasTheme } from './RectangleNodeRenderer';
import { drawWrappedText } from '../utils/canvasUtils';
import { CARD_DIMENSIONS } from '../utils/constants';
import { loadImage } from '../utils/imageCache';

/**
 * Draw a circle-shaped node on canvas
 * Used for custom node types configured with circle shape
 */
export function drawCircleNode(
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

  const radius = Math.max(CARD_DIMENSIONS.WIDTH, CARD_DIMENSIONS.HEIGHT) * 0.6;

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

  // Draw circle background
  const cardBg = theme?.cardBg ?? '#ffffff';
  const textPrimary = theme?.textPrimary ?? '#111827';
  const textSecondary = theme?.textSecondary ?? '#6b7280';
  const placeholderStart = theme?.placeholderStart ?? '#f3f4f6';
  const placeholderEnd = theme?.placeholderEnd ?? '#e5e7eb';

  ctx.fillStyle = cardBg;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  // Main border (colored by type)
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = borderWidth;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();

  // Inner circle for image area
  const innerRadius = radius * 0.5;
  const innerCenterX = x;
  const innerCenterY = y - radius * 0.3;

  // Try to load and draw image if available
  const image = node.image_url ? loadImage(node.image_url) : null;

  if (image) {
    // Create circular clipping path
    ctx.save();
    ctx.beginPath();
    ctx.arc(innerCenterX, innerCenterY, innerRadius, 0, Math.PI * 2);
    ctx.clip();

    // Draw the image to fill the circular area (object-cover style)
    const imgAspect = image.width / image.height;
    const diameter = innerRadius * 2;

    let drawWidth: number;
    let drawHeight: number;
    let drawX: number;
    let drawY: number;

    if (imgAspect > 1) {
      // Image is wider - fit by height
      drawHeight = diameter;
      drawWidth = diameter * imgAspect;
      drawX = innerCenterX - drawWidth / 2;
      drawY = innerCenterY - diameter / 2;
    } else {
      // Image is taller - fit by width
      drawWidth = diameter;
      drawHeight = diameter / imgAspect;
      drawX = innerCenterX - diameter / 2;
      drawY = innerCenterY - drawHeight / 2;
    }

    ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
    ctx.restore();

    // Draw border around image
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = borderWidth * 0.6;
    ctx.beginPath();
    ctx.arc(innerCenterX, innerCenterY, innerRadius, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    // Draw gradient placeholder if no image
    const gradient = ctx.createRadialGradient(innerCenterX, innerCenterY, 0, innerCenterX, innerCenterY, innerRadius);
    gradient.addColorStop(0, placeholderStart);
    gradient.addColorStop(1, placeholderEnd);
    ctx.fillStyle = gradient;

    ctx.beginPath();
    ctx.arc(innerCenterX, innerCenterY, innerRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = borderColor;
    ctx.lineWidth = borderWidth * 0.6;
    ctx.beginPath();
    ctx.arc(innerCenterX, innerCenterY, innerRadius, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Content layout
  ctx.textBaseline = 'top';

  // Primary text (name) - positioned below the inner circle
  const nameY = y - radius * 0.3 + innerRadius + 12;
  ctx.fillStyle = textPrimary;
  ctx.font = '600 12px Inter, system-ui, -apple-system';
  const nameLineHeight = 15;
  const maxTextWidth = radius * 1.5;
  const nameLines = drawWrappedText(ctx, node.name, x, nameY, maxTextWidth, nameLineHeight, 'center');

  // Secondary text (subtitle) - positioned below name
  if (node.subtitle && !simplified) {
    ctx.fillStyle = textSecondary;
    ctx.font = '400 10px Inter, system-ui, -apple-system';
    const subtitleY = nameY + (nameLines * nameLineHeight) + 6;
    drawWrappedText(ctx, node.subtitle, x, subtitleY, maxTextWidth, 12, 'center');
  }

  // Identity tag at bottom
  if (!simplified) {
    const tagY = y + radius * 0.6;
    const roleTag = node.type;
    ctx.font = '400 10px Inter, system-ui, -apple-system';

    const tagWidth = ctx.measureText(roleTag).width + 16;
    const tagX = x - tagWidth / 2;
    const tagHeight = 18;
    const tagRadius = 9;

    // pill background: solid type color
    ctx.fillStyle = borderColor;
    ctx.beginPath();
    ctx.moveTo(tagX + tagRadius, tagY);
    ctx.lineTo(tagX + tagWidth - tagRadius, tagY);
    ctx.quadraticCurveTo(tagX + tagWidth, tagY, tagX + tagWidth, tagY + tagRadius);
    ctx.lineTo(tagX + tagWidth, tagY + tagHeight - tagRadius);
    ctx.quadraticCurveTo(tagX + tagWidth, tagY + tagHeight, tagX + tagWidth - tagRadius, tagY + tagHeight);
    ctx.lineTo(tagX + tagRadius, tagY + tagHeight);
    ctx.quadraticCurveTo(tagX, tagY + tagHeight, tagX, tagY + tagHeight - tagRadius);
    ctx.lineTo(tagX, tagY + tagRadius);
    ctx.quadraticCurveTo(tagX, tagY, tagX + tagRadius, tagY);
    ctx.closePath();
    ctx.fill();

    // white text on solid background
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(roleTag, x, tagY + tagHeight / 2);
  }
}




