// The motion a VIEW arrives on: a Directory tab's content, a note surface, any
// block of page content replacing another. One duration, one curve, one
// distance, so switching between Grid, Context, Table and Resources reads as
// the same gesture four times rather than four surfaces each doing their own
// thing.
//
// This is deliberately NOT the tab bar's motion (components/ui/tabMotion.ts,
// 300ms on a material curve). The bar moving and the content arriving are two
// gestures, and collapsing them would make the underline and the page look like
// one sliding object.

/** Content fades and rises over this long. */
export const VIEW_ENTER_MS = 380;

/** Ease-out quint: commits immediately, settles without overshoot. Shared with
 *  `.card-rise` and the profile entrances in globals.css. */
export const VIEW_ENTER_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** How far below its resting place the content starts. */
export const VIEW_ENTER_SHIFT_PX = 12;

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
