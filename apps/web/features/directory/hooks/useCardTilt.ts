import { useCallback } from 'react'
import { prefersReducedMotion } from '@/lib/motion'

/**
 * Pointer-following tilt for a card: it lifts on hover and the edge the pointer
 * is nearest rises toward the viewer, as though the card were resting on a
 * cushion and being pressed at one corner.
 *
 * The rotation signs are not guesswork — they were measured in the browser by
 * projecting marker bars on each edge of a perspective-transformed box (under
 * perspective the nearer edge projects larger):
 *
 *   positive rotateY → LEFT edge nearer      → rotateY = -nx  (pointer left ⇒ left rises)
 *   positive rotateX → BOTTOM edge nearer    → rotateX =  ny  (pointer top  ⇒ top rises)
 *
 * Returns a callback ref, and it drives the node's inline `transform` directly
 * rather than through React state: the directory grid keeps a dozen-plus memoized
 * cards mounted, and re-rendering one of them per mousemove frame would spend the
 * whole frame budget on reconciliation to set one string.
 *
 * TWO THINGS ARE DELIBERATELY MISSING, both because they made the card's text go
 * fuzzy while hovered — do not add them back:
 *
 *   `will-change: transform` — it promotes the card to a composited layer that is
 *   rasterized once and then resampled by the transform, so the text is a
 *   stretched bitmap rather than re-rendered type. Without it the layer re-rasters
 *   as the transform changes, which is the whole point on an element carrying text.
 *
 *   `scale(1.015)` — a fractional scale resamples every glyph off the pixel grid
 *   for a change most people can't see anyway. The lift and the tilt sell the
 *   raise on their own.
 *
 * Some softening during the tilt itself is unavoidable: perspective-rotated text
 * genuinely is being drawn at an angle. Keeping MAX_TILT_DEG modest is the lever.
 */

/** Peak rotation at the card's edge. Past ~8° the card reads as a flipping panel. */
const MAX_TILT_DEG = 6
/** How far the whole card rises while hovered. */
const LIFT_PX = 6
const PERSPECTIVE_PX = 900
/**
 * A short transform transition during the move damps pointer jitter without the
 * tilt feeling like it lags the cursor; the settle back to flat is slower, since
 * an instant snap on leave looks like a glitch rather than a release.
 */
const TRACK_MS = 90
const SETTLE_MS = 320

const clamp = (n: number) => (n < -1 ? -1 : n > 1 ? 1 : n)

export function useCardTilt() {
  return useCallback((node: HTMLElement | null) => {
    if (!node) return
    // Reduced motion keeps the flat card and its hover shadow — no tilt, no lift.
    if (prefersReducedMotion()) return
    // Touch has no hover to follow, and a pointerdown would tilt the card under
    // the finger that is trying to tap it.
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return

    let frame = 0
    let point: { x: number; y: number } | null = null

    const paint = () => {
      frame = 0
      if (!point) return
      const r = node.getBoundingClientRect()
      // -1 at the left/top edge, 0 dead centre, 1 at the right/bottom edge.
      const nx = clamp(((point.x - r.left) / r.width) * 2 - 1)
      const ny = clamp(((point.y - r.top) / r.height) * 2 - 1)
      node.style.transform =
        `perspective(${PERSPECTIVE_PX}px) translateY(${-LIFT_PX}px) ` +
        `rotateX(${(ny * MAX_TILT_DEG).toFixed(2)}deg) rotateY(${(-nx * MAX_TILT_DEG).toFixed(2)}deg)`
    }

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint)
    }

    const onEnter = (e: PointerEvent) => {
      node.style.transition = `transform ${TRACK_MS}ms ease-out, box-shadow 200ms ease-out`
      point = { x: e.clientX, y: e.clientY }
      schedule()
    }

    const onMove = (e: PointerEvent) => {
      point = { x: e.clientX, y: e.clientY }
      schedule()
    }

    const onLeave = () => {
      point = null
      if (frame) { cancelAnimationFrame(frame); frame = 0 }
      node.style.transition = `transform ${SETTLE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 200ms ease-out`
      // Clear rather than write `none`, so the card falls back to whatever its
      // classes say (Tailwind v4's `scale`/`translate` utilities are separate
      // properties and keep working underneath).
      node.style.transform = ''
    }

    node.addEventListener('pointerenter', onEnter)
    node.addEventListener('pointermove', onMove, { passive: true })
    node.addEventListener('pointerleave', onLeave)

    // React 19 calls the cleanup returned by a callback ref on detach.
    return () => {
      if (frame) cancelAnimationFrame(frame)
      node.removeEventListener('pointerenter', onEnter)
      node.removeEventListener('pointermove', onMove)
      node.removeEventListener('pointerleave', onLeave)
      node.style.transform = ''
      node.style.transition = ''
    }
  }, [])
}
