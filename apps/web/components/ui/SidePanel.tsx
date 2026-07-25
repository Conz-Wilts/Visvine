'use client';

import React, { useEffect, useState } from 'react';
import { useEscapeKey } from '@/hooks/useEscapeKey';

/** Matches the CSS transition duration below — how long the exit animation runs. */
const TRANSITION_MS = 300;

export interface SidePanelProps {
  /** Drives the slide in/out. The panel stays mounted through the exit animation. */
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /**
   * Tailwind width class(es) applied from the `sm` breakpoint up (the panel is
   * full-width below it). Changing it mid-open animates, since width is part of
   * the panel's transition.
   */
  widthClass?: string;
  /** Which edge the panel slides in from (default 'right'). */
  side?: 'left' | 'right';
  /**
   * Popup styling: a rounded, shadowed card inset from the shell edges rather
   * than a sheet flush against them. On the left it clears the icon rail, so it
   * reads like the docked channels panel — just overlaid.
   */
  floating?: boolean;
  /** Close when the dim backdrop is clicked (default true). */
  closeOnBackdrop?: boolean;
  /** Close on the Escape key (default true). */
  closeOnEscape?: boolean;
  ariaLabel?: string;
}

/**
 * Slide-in panel docked to either edge of the viewport: dim backdrop,
 * full-height sheet (or an inset popup card, see `floating`), Escape +
 * backdrop-click dismissal.
 *
 * Unlike `Modal` (which unmounts the instant it closes, so a transform
 * transition never plays), this keeps its own mounted/shown pair — mount first,
 * flip `shown` on the next frame to animate in, and delay unmount by the
 * transition duration on the way out.
 */
export default function SidePanel({
  open,
  onClose,
  children,
  widthClass = 'sm:w-[440px]',
  side = 'right',
  floating = false,
  closeOnBackdrop = true,
  closeOnEscape = true,
  ariaLabel,
}: SidePanelProps) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);

  useEscapeKey(onClose, open && closeOnEscape);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // Paint once off-screen, then transition in on the next frame.
      const raf = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), TRANSITION_MS);
    return () => clearTimeout(t);
  }, [open]);

  if (!mounted) return null;

  // Flush sheet: full-height, hard against the chosen edge. Floating: an inset
  // card that clears the navbar (64px) and, on the left, the icon rail (76px) —
  // so it lines up with where the channels panel docks.
  const placement = floating
    ? `top-[76px] bottom-3 inset-x-3 w-auto rounded-2xl border border-border-subtle sm:inset-x-auto ${
        side === 'left' ? 'sm:left-[88px]' : 'sm:right-3'
      } ${widthClass}`
    : `top-0 h-full w-full border-border-subtle ${
        side === 'left' ? 'left-0 border-r' : 'right-0 border-l'
      } ${widthClass}`;

  // A floating card has to clear its own offset from the edge as well as its
  // width, or a sliver stays on screen while it's "closed".
  const hiddenTransform =
    side === 'left'
      ? floating ? '-translate-x-[calc(100%+96px)]' : '-translate-x-full'
      : floating ? 'translate-x-[calc(100%+24px)]' : 'translate-x-full';

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/30 transition-opacity duration-300 ease-out ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={closeOnBackdrop ? onClose : undefined}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className={`fixed z-50 flex flex-col overflow-hidden
          bg-surface-1 shadow-2xl
          transition-[transform,width] duration-300 ease-out
          ${placement} ${shown ? 'translate-x-0' : hiddenTransform}`}
      >
        {children}
      </aside>
    </>
  );
}
