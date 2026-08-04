/**
 * Folder (aggregate) node renderers for the folder view.
 *
 * A folder is deliberately a circle where entities are cards, so an aggregate
 * is never mistakable for a thing. The count is the hero: a folder's one
 * exact fact is how much it contains. Alias breakdowns (Founder ×5,
 * Investor ×3, …) render as their own smaller circles branching off the
 * folder — see drawAliasNode.
 */

import { NBNode } from '@/lib/types';
import { folderCount, folderRadius, aliasRadius } from '@/lib/context/folderView';
import { NOTE_NODE_RADIUS } from '@/lib/context/brainView';
import type { CanvasTheme } from './RectangleNodeRenderer';
import { withAlpha } from '../utils/canvasUtils';

export function drawFolderNode(
  ctx: CanvasRenderingContext2D,
  node: NBNode,
  x: number,
  y: number,
  isFocused: boolean,
  shouldDim: boolean,
  borderColor: string,
  theme?: CanvasTheme
): void {
  const count = folderCount(node);
  const radius = folderRadius(count);

  if (isFocused) {
    ctx.shadowColor = borderColor;
    ctx.shadowBlur = 24;
  } else if (!shouldDim) {
    ctx.shadowColor = borderColor;
    ctx.shadowBlur = 12;
  }

  // Tinted disc with a solid ring — lighter than the white entity cards so
  // folders read as containers, not content.
  ctx.fillStyle = withAlpha(borderColor, 0.12);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  ctx.fillStyle = theme?.cardBg ?? '#ffffff';
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.94, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = borderColor;
  ctx.lineWidth = isFocused ? 5 : 3;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.textAlign = 'center';

  // The count, front and centre.
  ctx.fillStyle = borderColor;
  ctx.font = `700 ${Math.round(radius * 0.42)}px Inter, system-ui, -apple-system`;
  ctx.textBaseline = 'middle';
  ctx.fillText(String(count), x, y - radius * 0.1);

  // Type label under it.
  ctx.fillStyle = theme?.textPrimary ?? '#111827';
  ctx.font = `600 ${Math.round(radius * 0.17)}px Inter, system-ui, -apple-system`;
  ctx.fillText(node.name, x, y + radius * 0.32);

  // Affordance whisper.
  ctx.fillStyle = theme?.textSecondary ?? '#6b7280';
  ctx.font = `400 ${Math.round(radius * 0.11)}px Inter, system-ui, -apple-system`;
  ctx.fillText('Click to Expand', x, y + radius * 0.55);
}

/**
 * An alias breakdown circle — how many of one role a folder holds
 * (e.g. Founder ×5). Solid alias colour so the role reads at a glance;
 * clicking it opens the parent folder.
 */
export function drawAliasNode(
  ctx: CanvasRenderingContext2D,
  node: NBNode,
  x: number,
  y: number,
  isFocused: boolean,
  shouldDim: boolean,
  borderColor: string,
  theme?: CanvasTheme
): void {
  const count = folderCount(node);
  const radius = aliasRadius(count);

  if (isFocused) {
    ctx.shadowColor = borderColor;
    ctx.shadowBlur = 18;
  } else if (!shouldDim) {
    ctx.shadowColor = borderColor;
    ctx.shadowBlur = 8;
  }

  ctx.fillStyle = withAlpha(borderColor, 0.16);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  ctx.fillStyle = theme?.cardBg ?? '#ffffff';
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.9, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = borderColor;
  ctx.lineWidth = isFocused ? 4 : 2.5;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = borderColor;
  ctx.font = `700 ${Math.round(radius * 0.52)}px Inter, system-ui, -apple-system`;
  ctx.fillText(String(count), x, y - radius * 0.14);

  ctx.fillStyle = theme?.textPrimary ?? '#111827';
  ctx.font = `600 ${Math.round(radius * 0.24)}px Inter, system-ui, -apple-system`;
  ctx.fillText(node.name, x, y + radius * 0.4);
}

/**
 * A plain (non-entity) note in the Folders view — a small white circle with a
 * page glyph and the note's title. Deliberately quieter than entity cards:
 * notes are content, but the people and orgs stay the heroes of the picture.
 */
export function drawNoteNode(
  ctx: CanvasRenderingContext2D,
  node: NBNode,
  x: number,
  y: number,
  isFocused: boolean,
  shouldDim: boolean,
  borderColor: string,
  theme?: CanvasTheme
): void {
  const radius = NOTE_NODE_RADIUS;

  if (isFocused) {
    ctx.shadowColor = borderColor;
    ctx.shadowBlur = 16;
  }

  ctx.fillStyle = theme?.cardBg ?? '#ffffff';
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  ctx.strokeStyle = shouldDim ? withAlpha(borderColor, 0.5) : borderColor;
  ctx.lineWidth = isFocused ? 3.5 : 2;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();

  // Page glyph: a rectangle with a folded corner, drawn with strokes.
  const gw = radius * 0.5;
  const gh = radius * 0.62;
  const gx = x - gw / 2;
  const gy = y - gh / 2 - radius * 0.14;
  const fold = gw * 0.32;
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(gx + gw - fold, gy);
  ctx.lineTo(gx, gy);
  ctx.lineTo(gx, gy + gh);
  ctx.lineTo(gx + gw, gy + gh);
  ctx.lineTo(gx + gw, gy + fold);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(gx + gw - fold, gy);
  ctx.lineTo(gx + gw - fold, gy + fold);
  ctx.lineTo(gx + gw, gy + fold);
  ctx.stroke();

  // Title under the glyph, clamped so long titles don't spill past the circle.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = theme?.textPrimary ?? '#111827';
  ctx.font = `600 11px Inter, system-ui, -apple-system`;
  const maxW = radius * 1.7;
  let title = node.name;
  if (ctx.measureText(title).width > maxW) {
    while (title.length > 1 && ctx.measureText(`${title}…`).width > maxW) {
      title = title.slice(0, -1);
    }
    title = `${title}…`;
  }
  ctx.fillText(title, x, y + radius * 0.5);
}
