/**
 * Square node renderer — a rounded-square node used for Community nodes.
 *
 * Visually mirrors the rounded-square community avatar (see ui/Avatar.tsx and
 * community/CommunityAvatar.tsx): a rounded square frame with a square image
 * inset at the top and name/subtitle/type tag below. Modelled on the hexagon
 * renderer it replaced, just with a square outline instead of a hexagon.
 */

import { NBNode } from '@/lib/types';
import type { CanvasTheme } from './RectangleNodeRenderer';
import { drawWrappedText, roundRect } from '../utils/canvasUtils';
import { CARD_DIMENSIONS, type NodeLOD } from '../utils/constants';
import { loadImage } from '../utils/imageCache';
import { getInitials } from '@/lib/avatarUtils';

function withAlpha(hex: string, alpha: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  return hex + Math.round(alpha * 255).toString(16).padStart(2, '0');
}

/**
 * Draw a rounded-square node on canvas. Used for the Community node type.
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

  const side = CARD_DIMENSIONS.SQUARE_SIDE;
  const half = side / 2;
  const left = x - half;
  const top = y - half;
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
  const textSecondary = theme?.textSecondary ?? '#6b7280';

  // Square background
  ctx.fillStyle = cardBg;
  roundRect(ctx, left, top, side, side, outerRadius);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  // Main border (colored by type)
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = borderWidth;
  roundRect(ctx, left, top, side, side, outerRadius);
  ctx.stroke();

  // Square image inset, centered horizontally in the upper portion
  const imageSize = side * 0.5;
  const imageX = x - imageSize / 2;
  const imageY = y - side * 0.22 - imageSize / 2;
  const imageRadius = 14;

  // Zoomed far out: flat colored inset keeps the silhouette readable without
  // image fetches, gradients, or text.
  if (lod === 'low') {
    ctx.fillStyle = borderColor;
    roundRect(ctx, imageX, imageY, imageSize, imageSize, imageRadius);
    ctx.fill();
    return;
  }

  const image = node.image_url ? loadImage(node.image_url) : null;

  if (image) {
    // Clip to rounded square and draw the image object-cover style
    ctx.save();
    roundRect(ctx, imageX, imageY, imageSize, imageSize, imageRadius);
    ctx.clip();

    const imgAspect = image.width / image.height;
    let drawWidth: number;
    let drawHeight: number;
    let drawX: number;
    let drawY: number;

    if (imgAspect > 1) {
      drawHeight = imageSize;
      drawWidth = imageSize * imgAspect;
      drawX = imageX - (drawWidth - imageSize) / 2;
      drawY = imageY;
    } else {
      drawWidth = imageSize;
      drawHeight = imageSize / imgAspect;
      drawX = imageX;
      drawY = imageY - (drawHeight - imageSize) / 2;
    }

    ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
    ctx.restore();

    ctx.strokeStyle = borderColor;
    ctx.lineWidth = borderWidth * 0.6;
    roundRect(ctx, imageX, imageY, imageSize, imageSize, imageRadius);
    ctx.stroke();
  } else {
    // Coloured placeholder + initials when there's no image
    if (lod === 'full') {
      const gradient = ctx.createLinearGradient(imageX, imageY, imageX + imageSize, imageY + imageSize);
      gradient.addColorStop(0, withAlpha(borderColor, 0.8));
      gradient.addColorStop(1, borderColor);
      ctx.fillStyle = gradient;
    } else {
      ctx.fillStyle = borderColor;
    }

    roundRect(ctx, imageX, imageY, imageSize, imageSize, imageRadius);
    ctx.fill();

    ctx.strokeStyle = borderColor;
    ctx.lineWidth = borderWidth * 0.6;
    roundRect(ctx, imageX, imageY, imageSize, imageSize, imageRadius);
    ctx.stroke();

    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${Math.round(imageSize * 0.4)}px Inter, system-ui, -apple-system`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(getInitials(node.name ?? ''), imageX + imageSize / 2, imageY + imageSize / 2);
    ctx.restore();
  }

  // Content layout
  ctx.textBaseline = 'top';

  // Primary text (name) - positioned below the image
  const nameY = imageY + imageSize + 12;
  ctx.fillStyle = textPrimary;
  ctx.font = '600 13px Inter, system-ui, -apple-system';
  const nameLineHeight = 16;
  const maxTextWidth = side - 32;
  const nameLines = drawWrappedText(ctx, node.name, x, nameY, maxTextWidth, nameLineHeight, 'center');

  // Subtitle + type tag are full-detail only.
  if (lod !== 'full') return;

  if (node.subtitle) {
    ctx.fillStyle = textSecondary;
    ctx.font = '400 10px Inter, system-ui, -apple-system';
    const subtitleY = nameY + (nameLines * nameLineHeight) + 6;
    drawWrappedText(ctx, node.subtitle, x, subtitleY, maxTextWidth, 12, 'center');
  }

  // Identity tag near the bottom
  const tagY = y + half - CARD_DIMENSIONS.PADDING - CARD_DIMENSIONS.TAG_HEIGHT;
  const roleTag = node.type;
  ctx.font = '400 10px Inter, system-ui, -apple-system';

  const tagWidth = ctx.measureText(roleTag).width + 16;
  const tagX = x - tagWidth / 2;
  const tagHeight = CARD_DIMENSIONS.TAG_HEIGHT;

  ctx.fillStyle = borderColor;
  roundRect(ctx, tagX, tagY, tagWidth, tagHeight, 9);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(roleTag, x, tagY + tagHeight / 2);
}
