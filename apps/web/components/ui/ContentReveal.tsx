'use client';

import React, { useEffect, useRef, useState } from 'react';

/** Reveal duration. Deliberately long — this is the whole transition from the
 *  context canvas to an open note, and the old 0.4s CSS entrance was over before
 *  the note it was supposed to introduce had even loaded. */
const REVEAL_MS = 620;

/** Ease-out cubic: quick to commit, long gentle settle. No overshoot — a spring
 *  curve on a page-sized block of text reads as a wobble, not as polish. */
const REVEAL_EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)';

/** How long the curtain may stay down before it opens on whatever is there. */
const STUCK_MS = 2500;

interface ContentRevealProps {
  /** Flip to true once the content underneath has actually loaded. Until then the
   *  subtree stays mounted but invisible, so all the expensive work (chunk parse,
   *  editor mount, layout) happens BEHIND the curtain instead of during the
   *  animation. */
  ready: boolean;
  className?: string;
  style?: React.CSSProperties;
  /** Passed through so this can stand in for the wrapper it replaced (the profile
   *  pages' role="tabpanel" content div). */
  role?: string;
  children: React.ReactNode;
}

/**
 * Holds an incoming view hidden until it reports itself loaded, then fades and
 * lifts it in.
 *
 * This exists because the old approach — a `profile-enter` CSS animation on
 * mount — animated the wrong thing at the wrong time. The note panels gate their
 * real content behind their own fetches, so the 0.4s entrance played out on an
 * empty container and the note then appeared abruptly with no animation at all:
 * "I can hardly see the transition". Worse, whatever DID animate was animating
 * while Tiptap mounted underneath it, so the frames it managed to draw dropped.
 *
 * Two rules make it smooth:
 *  - Reveal is driven by `ready`, not by mount, so the animation always has real
 *    content to animate and never competes with the work that produced it.
 *  - It waits two frames after `ready` before starting. The first frame commits
 *    the loaded subtree; the browser spends it on layout/paint of a large tree.
 *    Starting the transition on that same frame is what made the opening stutter.
 *
 * Opacity + translate only. The old keyframes also scaled, which forces the
 * compositor to re-rasterize every glyph in an editor-sized subtree each frame —
 * a real source of the jank. `transform` returns to `none` (not `translateY(0)`)
 * once shown, so this never lingers as a containing block for fixed-position
 * modals rendered inside.
 */
export default function ContentReveal({ ready, className, style, role, children }: ContentRevealProps) {
  const [shown, setShown] = useState(false);
  // will-change is dropped once the transition ends: holding a compositor layer
  // for the lifetime of a note view costs memory and buys nothing after the move.
  const [settled, setSettled] = useState(false);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  useEffect(() => {
    if (!ready) {
      setShown(false);
      setSettled(false);
      // Failsafe: whatever is under the curtain gets shown eventually. A hidden
      // body is the right trade for the few hundred ms a note fetch takes, but if
      // `ready` never arrives (no space resolved, a request that hangs) the
      // page must fall back to showing its skeleton or error rather than nothing.
      const bail = setTimeout(() => setShown(true), STUCK_MS);
      return () => clearTimeout(bail);
    }
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setShown(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [ready]);

  const animate = shown && !reduced.current;

  // Callers pass their own transitions on this element (the note surfaces animate
  // padding-left as the docked tree opens), so the reveal APPENDS to whatever
  // they set instead of replacing it — overwriting `transition` would make the
  // panel column snap the content sideways.
  const reveal = animate
    ? `opacity ${REVEAL_MS}ms ${REVEAL_EASE}, transform ${REVEAL_MS}ms ${REVEAL_EASE}`
    : '';
  const transition = [style?.transition, reveal].filter(Boolean).join(', ') || undefined;

  return (
    <div
      className={className}
      role={role}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget) setSettled(true);
      }}
      style={{
        ...style,
        opacity: shown ? 1 : 0,
        transform: shown ? 'none' : 'translateY(12px)',
        transition,
        willChange: animate && !settled ? 'opacity, transform' : undefined,
      }}
    >
      {children}
    </div>
  );
}
