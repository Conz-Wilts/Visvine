import { motion } from '@visvine/tokens';

// The motion a VIEW arrives on: a Directory tab's content, a note surface, any
// block of page content replacing another. One duration, one curve, one
// distance, so switching between Grid, Context, Table and Resources reads as
// the same gesture four times rather than four surfaces each doing their own
// thing.
//
// This is deliberately NOT the tab bar's motion (below, 300ms on a material
// curve). The bar moving and the content arriving are two
// gestures, and collapsing them would make the underline and the page look like
// one sliding object.

/** Content fades and rises over this long — the `motion.duration.slow` token. */
export const VIEW_ENTER_MS = motion.duration.slow;

/** `motion.ease.enter`, an ease-out quint: commits immediately, settles without
 *  overshoot. Shared with `.card-rise` and the profile entrances in globals.css. */
export const VIEW_ENTER_EASE = motion.easeCss.enter;

/** How far below its resting place the content starts. */
export const VIEW_ENTER_SHIFT_PX = 12;

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// The motion every pane-top tab bar shares: underline slide, attached region
// open, tray translate and label FLIP all run on this duration and curve (the
// `motion.duration.base` and `motion.ease.standard` tokens), so a tab change
// reads as one gesture. TAB_MOTION is kept as a full literal so Tailwind's
// class scanner sees it; the other two are for inline styles and WAAPI.

export const TAB_MOTION_MS = motion.duration.base;

export const TAB_MOTION_EASE = motion.easeCss.standard;

export const TAB_MOTION = 'duration-300 ease-standard';

// An in-place tab-SET change (a word joining or leaving the persistent bar,
// e.g. Grid dropping off when the root index hands over to a plain note) runs
// slower than a tab switch: the reader needs a beat to see the bar itself is
// changing shape, not just the selection moving.
export const TAB_SET_MOTION_MS = motion.duration.slower;
