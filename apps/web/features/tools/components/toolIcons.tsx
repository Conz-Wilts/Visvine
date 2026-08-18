/**
 * The rail icons an installed Tool may choose from.
 *
 * A Tool names one of `TOOL_RAIL_ICONS` (lib/tools/config.ts) in its
 * frontmatter, and this is where that name becomes a glyph. The set is closed on
 * purpose: the sidebar is app chrome a Tool is never allowed to touch, so it
 * picks from Visvine's own shapes rather than shipping its own SVG.
 *
 * Every icon is drawn to the Sidebar's spec — 24×24 box, 1.8 stroke, round caps
 * and joins, `currentColor` — so an installed Tool's row is indistinguishable
 * from a built-in one and inherits the active pill's colour transition for free.
 */
import type { ReactNode } from 'react';

/** Same class the built-in feature icons use — see features/shared/lib/features.tsx. */
const iconClass = 'h-5 w-5 shrink-0';

const strokeProps = {
  className: iconClass,
  fill: 'none',
  stroke: 'currentColor',
  viewBox: '0 0 24 24',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/**
 * Keyed by the icon names in TOOL_RAIL_ICONS. Kept as a plain record rather than
 * a switch so a name that set gains without a glyph here is a missing key (which
 * falls back below) instead of a hole in the rail.
 */
const ICONS: Record<string, ReactNode> = {
  grid: (
    <svg {...strokeProps}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </svg>
  ),
  kanban: (
    <svg {...strokeProps}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16M15 4v16M6 8h0M12 8h0M18 8h0" />
    </svg>
  ),
  list: (
    <svg {...strokeProps}>
      <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
    </svg>
  ),
  table: (
    <svg {...strokeProps}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9.5h18M10 9.5V20" />
    </svg>
  ),
  calendar: (
    <svg {...strokeProps}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 11h18" />
    </svg>
  ),
  chart: (
    <svg {...strokeProps}>
      <path d="M4 20V4M4 20h16" />
      <path d="M8.5 20v-6M13 20v-9.5M17.5 20V8" />
    </svg>
  ),
  note: (
    <svg {...strokeProps}>
      <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </svg>
  ),
  folder: (
    <svg {...strokeProps}>
      <path d="M3 7a2 2 0 012-2h4l2 2.5h8a2 2 0 012 2V18a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </svg>
  ),
  people: (
    <svg {...strokeProps}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19a5.5 5.5 0 0111 0" />
      <path d="M16 5.5a3.2 3.2 0 010 5.6M17.5 14.2A5.5 5.5 0 0120.5 19" />
    </svg>
  ),
  sparkle: (
    <svg {...strokeProps}>
      <path d="M12 3.5l1.9 4.9 4.9 1.9-4.9 1.9L12 17.1l-1.9-4.9L5.2 10.3l4.9-1.9L12 3.5z" />
      <path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z" />
    </svg>
  ),
};

/**
 * The glyph for a Tool's declared rail icon. Unknown or absent names fall back
 * to `grid` — `parseToolConfig` already refuses an icon outside the set, so this
 * only catches an install pinned to a version published before a name existed,
 * and a hole in the sidebar would be worse than the wrong shape.
 */
export default function ToolIcon({ name }: { name: string | null | undefined }) {
  return <>{ICONS[(name ?? '').trim().toLowerCase()] ?? ICONS.grid}</>;
}
