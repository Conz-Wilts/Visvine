'use client'

// Rows that slide to their new place instead of jumping there — the motion
// half of drag-to-move (useTreeDrag is the gesture half).
//
// While a row is held, the tree keeps re-laying itself out: the slot the held
// row would drop into moves between rows as the pointer does, folders spring
// open under the pointer and shut behind it. Each of those is an instant
// DOM change. This hook makes it read as movement with FLIP: it remembers where
// every row was after the last layout, and when the layout changes it starts
// each row that moved from its OLD position (a transform) and lets it ease to
// the new one. It is how sortable lists animate — only transforms, never
// layout, so it costs a paint and nothing else.
//
// When a folder opens or shuts (`folds` changed) it also holds the row under
// the pointer still across the change, by scrolling the tree by however far
// that row was pushed. The slot moving is NOT held: rows trading places with
// the held one is the point, and the tree must not scroll to undo it. Without it a folder shutting
// above the pointer pulls everything up from under it; with it, the rows ABOVE
// slide instead and the pointer stays on what it was on. When the tree can't
// scroll that far (it is short, or at an end) the rows under the pointer slide
// instead — still animated, and useTreeDrag never retargets on a layout change
// alone, so it cannot flicker.
//
// Positions are kept relative to the scrolled content, and compared in viewport
// space against the scroll offset of the frame before, so neither the user's
// scrolling nor the drag's edge-scrolling is mistaken for a row having moved.

import { useLayoutEffect, useRef } from 'react'
import type { DragProbe } from './useTreeDrag'

const FLIP_ID = 'tree-flip'
const DURATION = 200
const EASING = 'cubic-bezier(0.25, 1, 0.5, 1)'

export function useTreeFlip(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  probe: React.RefObject<DragProbe>,
  /** A row is being held. */
  active: boolean,
  /** Changes identity whenever the tree may have been laid out differently. */
  layout: unknown,
  /** Changes identity when a folder has opened or shut. */
  folds: unknown,
) {
  /** Row key → top within the scrolled content, as of the last layout. */
  const snapshot = useRef(new Map<string, number>())
  const wasActive = useRef(false)
  const lastFolds = useRef(folds)

  useLayoutEffect(() => {
    const sc = scrollRef.current
    const run = active || wasActive.current
    wasActive.current = active
    const folded = lastFolds.current !== folds
    lastFolds.current = folds
    if (!sc || !run) {
      snapshot.current.clear()
      return
    }

    const rows = [...sc.querySelectorAll<HTMLElement>('[data-flip-key]')]
    // A row still easing from the last change starts the next one from where it
    // visibly IS, not from where it was headed: read its offset, then stop it.
    const carried = new Map<HTMLElement, number>()
    const tops = new Map<HTMLElement, number>()
    for (const row of rows) {
      const running = row.getAnimations().filter((a) => a.id === FLIP_ID)
      if (running.length > 0) {
        const shown = row.getBoundingClientRect().top
        for (const a of running) a.cancel()
        const laidOut = row.getBoundingClientRect().top
        carried.set(row, shown - laidOut)
        tops.set(row, laidOut)
      } else {
        tops.set(row, row.getBoundingClientRect().top)
      }
    }

    // Hold the row under the pointer where it was.
    const p = probe.current
    const scrollBefore = p.el ? p.scrollTop : sc.scrollTop
    const measuredAt = sc.scrollTop
    if (active && folded && p.el?.isConnected) {
      const now = tops.get(p.el as HTMLElement) ?? p.el.getBoundingClientRect().top
      const drift = now - p.top
      if (drift !== 0) sc.scrollTop = measuredAt + drift
    }
    const scrolled = sc.scrollTop - measuredAt

    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const next = new Map<string, number>()
    for (const row of rows) {
      const key = row.dataset.flipKey!
      const top = tops.get(row)! - scrolled
      next.set(key, top + sc.scrollTop)
      const was = snapshot.current.get(key)
      if (was === undefined || still) continue
      const delta = was - scrollBefore + (carried.get(row) ?? 0) - top
      if (Math.abs(delta) < 0.5) continue
      row.animate([{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }], {
        id: FLIP_ID,
        duration: DURATION,
        easing: EASING,
      })
    }
    snapshot.current = next
  }, [scrollRef, probe, active, layout, folds])
}
