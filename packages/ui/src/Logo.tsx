'use client';

import { useId } from 'react';
import { color, palette } from '@visvine/tokens';

type LogoVariant = 'mark' | 'tile';

interface LogoProps {
  /**
   * `mark` is the glyph alone in the brand green, for a light surface. `tile`
   * is the white glyph on the brand-green rounded square, the app icon.
   */
  variant?: LogoVariant;
  /** Width and height in px. Tailwind size classes on `className` override it. */
  size?: number;
  /** Accessible name. Omit when a visible "Visvine" sits beside it. */
  title?: string;
  className?: string;
}

// The mark on the app icon's 1024 grid: three ringed nodes joined into a V.
// packages/tokens/assets/logo holds the raster originals these match.
const NODES = [
  [256, 256],
  [768, 256],
  [512, 768],
] as const;
const RING_RADIUS = 107.5;
const RING_WIDTH = 21;
const DOT_RADIUS = 58;
const BAR_WIDTH = 77;
// A bar stops at a ring's inner edge, so the gap between ring and dot stays open.
const BAR_CUTOUT = RING_RADIUS - RING_WIDTH / 2;
const TILE_RADIUS = 205;
// The glyph's own bounds, so `mark` sits flush in its box.
const MARK_VIEWBOX = '138 138 748 748';

/**
 * The Visvine logo. Painted in the `brand` colour, the logo green, which never
 * follows the accent a person picks.
 */
export default function Logo({ variant = 'mark', size = 32, title, className }: LogoProps) {
  const maskId = useId();
  const tile = variant === 'tile';
  const ink = tile ? palette.white : color.brand.default;

  return (
    <svg
      viewBox={tile ? '0 0 1024 1024' : MARK_VIEWBOX}
      width={size}
      height={size}
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
          <rect width="1024" height="1024" fill={palette.white} />
          {NODES.map(([cx, cy]) => (
            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={BAR_CUTOUT} fill={palette.black} />
          ))}
        </mask>
      </defs>
      {tile && <rect width="1024" height="1024" rx={TILE_RADIUS} fill={color.brand.default} />}
      <g stroke={ink} strokeWidth={BAR_WIDTH} mask={`url(#${maskId})`}>
        <line x1={NODES[0][0]} y1={NODES[0][1]} x2={NODES[2][0]} y2={NODES[2][1]} />
        <line x1={NODES[1][0]} y1={NODES[1][1]} x2={NODES[2][0]} y2={NODES[2][1]} />
      </g>
      {NODES.map(([cx, cy]) => (
        <g key={`${cx}-${cy}`}>
          <circle cx={cx} cy={cy} r={RING_RADIUS} fill="none" stroke={ink} strokeWidth={RING_WIDTH} />
          <circle cx={cx} cy={cy} r={DOT_RADIUS} fill={ink} />
        </g>
      ))}
    </svg>
  );
}
