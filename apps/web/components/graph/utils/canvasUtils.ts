/**
 * Canvas drawing utilities for graph rendering
 */

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
export function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  align: 'left' | 'center' = 'left'
): number {
  const words = text.split(' ');
  let line = '';
  let lineY = y;
  const maxLines = 2; // Limit to 2 lines to fit in card
  let lineCount = 0;

  ctx.textAlign = align;

  for (let i = 0; i < words.length; i++) {
    const testLine = line + (line ? ' ' : '') + words[i];
    const metrics = ctx.measureText(testLine);

    if (metrics.width > maxWidth && line !== '') {
      // Draw the current line
      ctx.fillText(line, x, lineY);
      line = words[i];
      lineY += lineHeight;
      lineCount++;

      if (lineCount >= maxLines) {
        break;
      }
    } else {
      line = testLine;
    }
  }

  // Draw the last line
  if (lineCount < maxLines && line) {
    ctx.fillText(line, x, lineY);
    lineCount++;
  }

  return lineCount;
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

/**
 * Draw a hexagon path with rounded corners (flat side on bottom)
 * @param ctx - Canvas rendering context
 * @param x - Center X position
 * @param y - Center Y position
 * @param radius - Radius from center to vertices
 * @param cornerRadius - Radius of the rounded corners (default: 12)
 */
export function drawHexagon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  cornerRadius: number = 12
): void {
  // Calculate all 6 vertices of the hexagon
  const vertices: { x: number; y: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 3; // Rotate 30 degrees for flat bottom
    vertices.push({
      x: x + radius * Math.cos(angle),
      y: y + radius * Math.sin(angle)
    });
  }

  ctx.beginPath();

  // Start at a point offset from the first vertex
  const firstToSecond = { 
    x: vertices[1].x - vertices[0].x, 
    y: vertices[1].y - vertices[0].y 
  };
  const lenFirstEdge = Math.sqrt(firstToSecond.x * firstToSecond.x + firstToSecond.y * firstToSecond.y);
  const offset = Math.min(cornerRadius, lenFirstEdge / 2);
  const startX = vertices[0].x + (firstToSecond.x / lenFirstEdge) * offset;
  const startY = vertices[0].y + (firstToSecond.y / lenFirstEdge) * offset;
  ctx.moveTo(startX, startY);

  // Draw each edge with rounded corners
  for (let i = 0; i < 6; i++) {
    const current = vertices[i];
    const next = vertices[(i + 1) % 6];
    
    // Vector from current to next vertex
    const toNext = { x: next.x - current.x, y: next.y - current.y };
    const edgeLen = Math.sqrt(toNext.x * toNext.x + toNext.y * toNext.y);
    const normalized = { x: toNext.x / edgeLen, y: toNext.y / edgeLen };
    
    // Calculate offset for rounded corner
    const cornerOffset = Math.min(cornerRadius, edgeLen / 2);
    
    // Point before the next vertex (start of curve)
    const beforeNext = {
      x: next.x - normalized.x * cornerOffset,
      y: next.y - normalized.y * cornerOffset
    };
    
    // Draw line to the point before the corner
    ctx.lineTo(beforeNext.x, beforeNext.y);
    
    // If not the last iteration, draw the rounded corner
    if (i < 5) {
      const afterNext = vertices[(i + 2) % 6];
      const nextEdge = { x: afterNext.x - next.x, y: afterNext.y - next.y };
      const nextEdgeLen = Math.sqrt(nextEdge.x * nextEdge.x + nextEdge.y * nextEdge.y);
      const nextNormalized = { x: nextEdge.x / nextEdgeLen, y: nextEdge.y / nextEdgeLen };
      const nextCornerOffset = Math.min(cornerRadius, nextEdgeLen / 2);
      
      const afterCorner = {
        x: next.x + nextNormalized.x * nextCornerOffset,
        y: next.y + nextNormalized.y * nextCornerOffset
      };
      
      // Draw the rounded corner using quadratic curve
      ctx.quadraticCurveTo(next.x, next.y, afterCorner.x, afterCorner.y);
    }
  }

  // Close the path with a rounded corner back to start
  ctx.quadraticCurveTo(vertices[0].x, vertices[0].y, startX, startY);
  ctx.closePath();
}

