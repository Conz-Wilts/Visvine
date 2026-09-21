'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { SHELL_FRAME_GAP, SHELL_FRAME_MARGIN, SHELL_FRAME_RADIUS, SHELL_PANE_TOP, SHELL_TOP_BAR_H } from '@/features/shared/contexts/ThemeContext';

/**
 * Hides the page scrollbar behind a pane-top tab bar.
 *
 * Page scroll lives in the shell's <main> (see AuthLayoutClient), whose
 * scrollbar track starts at the top of the surface and ran up the right edge
 * *alongside* the pinned tab bar. The bar can't cover it: a scroller always
 * paints its own scrollbar above its content.
 *
 * A fixed element outside the scroller can, so this parks one over the
 * scrollbar gutter for exactly the bar's height. The scrollbar then reads as
 * starting below the bar. The strip is plain white by default — the bars it
 * serves draw no seam, so neither does it; `border` exists for a bar that
 * does and wants its line carried across the gutter.
 *
 * It also insets <main>'s scroll track by its own height (see globals.css,
 * `--scrollbar-track-inset`), because the strip alone hides a short thumb
 * completely at rest — the thumb's travel has to start below the bar too.
 *
 * Render it from any bar pinned at the top of the surface; it mounts and
 * unmounts with that bar.
 */
export default function PaneTopScrollbarMask({
  /** Bar height in px — the h-12 tab row by default. */
  height = 48,
  /** Viewport-y of the mask's bottom edge; overrides `height` when set. Lets a
      bar of variable/measured height (e.g. a toolbar that grows a chip row)
      mask exactly down to its own bottom. */
  bottom,
  /** Bottom seam on the strip, for a bar that draws its own border-b. */
  border = false,
  /** Draw only the seam, not the surface: the strip's background goes clear so
      the scrollbar thumb stays visible behind it, and just the 1px border-b
      carries the bar's line across the gutter. */
  transparent = false,
}: {
  height?: number;
  bottom?: number;
  border?: boolean;
  transparent?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // The strip starts where <main> does — under the shell's top band — so it
  // covers the clearance above the bar as well as the bar itself, and the track
  // runs through both.
  // +1: below the sheet's top hairline (FRAME_LINE), which it would paint over.
  const top = SHELL_TOP_BAR_H + SHELL_FRAME_GAP + 1;
  const resolvedHeight = bottom != null ? Math.max(0, bottom - top) : height + SHELL_PANE_TOP;

  // Set on <main> itself so Chromium re-resolves the scrollbar style when it
  // changes.
  useEffect(() => {
    const main = document.querySelector('main');
    if (!main) return;
    main.style.setProperty('--scrollbar-track-inset', `${resolvedHeight}px`);
    return () => { main.style.removeProperty('--scrollbar-track-inset'); };
  }, [resolvedHeight]);

  if (!mounted) return null;

  // A fixed strip always paints over <main>'s native scrollbar — nothing can
  // put the thumb back in front of it. So the seam-only variant stops short of
  // the 8px scrollbar column (see globals.css) and the scrollbar reads as
  // passing in front of the line rather than being cut by it.
  const scrollbarW = transparent ? 8 : 0;

  return createPortal(
    <div
      aria-hidden
      // z-40 keeps it under the navbar (z-50) and under modals. Position and
      // size are inline throughout: every edge is derived from the shell's
      // SHELL_FRAME_* geometry (see AuthLayoutClient) rather than a fixed
      // utility, so the mask tracks the content surface exactly.
      className={`pointer-events-none fixed z-40 ${transparent ? '' : 'bg-glass'} ${
        border ? 'border-b border-border-subtle' : ''
      }`}
      style={{
        height: resolvedHeight,
        right: SHELL_FRAME_GAP + SHELL_FRAME_MARGIN + scrollbarW,
        // 16px, not the 12px a w-3 strip would give: classic (always-on)
        // scrollbars are 15px wide, and a sliver of track peeked past the
        // mask's left edge.
        width: 16 - scrollbarW,
        // Where <main> (and its scrollbar) starts: under the shell's top band,
        // plus any gap above the content region.
        top,
        borderTopRightRadius: transparent ? 0 : SHELL_FRAME_RADIUS,
      }}
    />,
    document.body,
  );
}
