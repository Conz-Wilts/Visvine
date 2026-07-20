/**
 * Canvas drawing utilities for graph rendering
 */

import { NODE_GLYPH_PATHS, type NodeGlyph } from '@/lib/avatarUtils';

// Append an alpha channel to a 6-digit hex color; passes anything else through.
export function withAlpha(hex: string, alpha: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  return hex + Math.round(alpha * 255).toString(16).padStart(2, '0');
}

// Reuse a single Path2D for each glyph across every node draw.
const glyphPaths = Object.fromEntries(
  Object.entries(NODE_GLYPH_PATHS).map(([glyph, path]) => [glyph, new Path2D(path)])
) as Record<NodeGlyph, Path2D>;

/**
 * Draw a node type's silhouette avatar fallback (the shared 24×24 glyph —
 * person, group, event, or resource) centred at (cx, cy), scaled so the glyph
 * spans `glyphSize` px. Caller draws the backing shape first; this fills the
 * silhouette in `color`.
 */
export function drawGlyphSilhouette(
  ctx: CanvasRenderingContext2D,
  glyph: NodeGlyph,
  cx: number,
  cy: number,
  glyphSize: number,
  color: string
): void {
  const scale = glyphSize / 24;
  ctx.save();
  ctx.translate(cx - glyphSize / 2, cy - glyphSize / 2);
  ctx.scale(scale, scale);
  ctx.fillStyle = color;
  ctx.fill(glyphPaths[glyph]);
  ctx.restore();
}

/**
 * Draw wrapped text across multiple lines
 * @param ctx - Canvas rendering context
 * @param text - Text to draw
 * @param x - X position (depends on alignment)
 * @param y - Y position (top of first line)
 * @param maxWidth - Maximum width before wrapping
 * @param lineHeight - Height of each line
 * @param align - Text alignment ('left' or 'center')
 * @returns Number of lines drawn
 */
// Node names/subtitles never change between frames, but wrapping measures every
// word with ctx.measureText — per card, per frame. Cache the computed lines per
// (font, width, text); the cache is tiny relative to the cost it removes.
const wrapCache = new Map<string, string[]>();
const WRAP_CACHE_MAX = 4000;

function getWrappedLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const key = `${ctx.font}|${maxWidth}|${text}`;
  const cached = wrapCache.get(key);
  if (cached) return cached;

  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';

  for (let i = 0; i < words.length; i++) {
    const testLine = line + (line ? ' ' : '') + words[i];
    if (ctx.measureText(testLine).width > maxWidth && line !== '') {
      lines.push(line);
      line = words[i];
      if (lines.length >= maxLines) {
        line = '';
        break;
      }
    } else {
      line = testLine;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);

  if (wrapCache.size >= WRAP_CACHE_MAX) wrapCache.clear();
  wrapCache.set(key, lines);
  return lines;
}

export function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  align: 'left' | 'center' = 'left'
): number {
  ctx.textAlign = align;
  const lines = getWrappedLines(ctx, text, maxWidth, 2);
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x, y + i * lineHeight);
  }
  return lines.length;
}

/**
 * Draw a rounded rectangle
 * @param ctx - Canvas rendering context
 * @param x - X position (top-left)
 * @param y - Y position (top-left)
 * @param width - Width of rectangle
 * @param height - Height of rectangle
 * @param radius - Corner radius
 */
export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

