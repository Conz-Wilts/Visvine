'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Hides the page scrollbar behind a pane-top tab bar.
 *
 * Page scroll lives in the shell's <main> (see AuthLayoutClient), which starts
 * directly under the fixed navbar — so its scrollbar track starts there too,
 * and ran up the right edge *alongside* the pinned tab bar. The bar can't cover
 * it: a scroller always paints its own scrollbar above its content.
 *
 * A fixed element outside the scroller can, so this parks one over the
 * scrollbar gutter for exactly the bar's height. The scrollbar then reads as
 * starting below the bar, and the strip's bottom border carries the bar's seam
 * the last few pixels to the viewport edge (the gutter is outside <main>'s
 * content box, so the bar's own border stops short of it).
 *
 * Render it from any bar pinned flush under the navbar; it mounts and unmounts
 * with that bar.
 */
export default function PaneTopScrollbarMask({
  /** Bar height in px — matches the h-12 tab row by default. */
  height = 48,
}: {
  height?: number;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div
      aria-hidden
      // top-16 = the navbar's h-16, i.e. where <main> (and its scrollbar) starts.
      // z-40 keeps it under the navbar (z-50) and under modals.
      className="pointer-events-none fixed right-0 top-16 z-40 w-3 border-b border-border-subtle bg-surface-1"
      style={{ height }}
    />,
    document.body,
  );
}
