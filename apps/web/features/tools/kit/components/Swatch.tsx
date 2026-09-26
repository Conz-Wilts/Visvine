import type { CSSProperties } from 'react';
import { clsx } from 'clsx';

export interface SwatchProps {
  /** Any CSS colour — a chart slot (`useChartColors()[i]`) or `var(--vv-…)`. */
  color: string;
  size?: 'sm' | 'md';
  className?: string;
  style?: CSSProperties;
}

/**
 * The one mark for "this colour means this thing": a round dot, the shape the
 * chart legends draw. A legend row, a status beside a label and a series key
 * all use it, so a colour never appears as a circle in one place and a square
 * in the next.
 */
export function Swatch({ color, size = 'sm', className, style }: SwatchProps) {
  return (
    <span
      aria-hidden
      className={clsx('inline-block shrink-0 rounded-full', size === 'sm' ? 'h-2 w-2' : 'h-3 w-3', className)}
      style={{ ...style, background: color }}
    />
  );
}
