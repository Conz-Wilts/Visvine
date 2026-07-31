// Cross-page underline handoff for the pane-top tab bars.
//
// Shell-boundary transitions only: everything under /directory shares one
// persistent PaneTabBar, so navigations there animate as prop changes. This
// bridges the seams where two different bar components genuinely replace each
// other at the same position (/directory ⇄ /events, or a fresh mount shortly
// after such a swap). Each bar publishes its underline rect as it measures, and
// a bar mounting within the freshness window slides from that rect to its own
// active tab, so the two read as one bar relabelling itself.
//
// Positions are comparable because the bars share the same bleed, row height,
// font and paddings; keyed so unrelated tab bars can't hand off into these.

import { useRef, useState, type RefObject } from 'react'

export interface IndicatorRect {
  left: number
  width: number
}

// On globalThis (like lib/messages/realtime.ts) so the store survives Fast
// Refresh and stays a singleton across route chunks — a rect published by one
// page must be readable by the next.
const globalStore = globalThis as unknown as {
  __tabIndicatorHandoff?: Map<string, IndicatorRect & { at: number }>
}
const store = (globalStore.__tabIndicatorHandoff ??= new Map())

/** How long a published rect stays claimable. Long enough to span a route
 *  transition (the incoming bars render up front, before their data), short
 *  enough that a bar mounting much later doesn't slide in from a stale spot. */
const FRESH_MS = 2500

export function publishTabIndicator(key: string, rect: IndicatorRect): void {
  store.set(key, { ...rect, at: Date.now() })
}

/** The last published rect for `key`, or null when nothing fresh is there.
 *  Deliberately not cleared on read: StrictMode runs useState initializers
 *  twice, so a destructive take would hand the real value to the discarded
 *  render and null to the kept one. The freshness window bounds staleness. */
function takeTabIndicator(key: string): IndicatorRect | null {
  const entry = store.get(key)
  if (!entry) return null
  if (Date.now() - entry.at > FRESH_MS) return null
  return { left: entry.left, width: entry.width }
}

/** Claim the outgoing bar's rect once, at mount, plus the latch that lets the
 *  first measure spend it. Un-keyed bars claim nothing. */
export function useTabIndicatorHandoff(key: string | undefined) {
  const [handoff] = useState(() => (key ? takeTabIndicator(key) : null))
  const firstMeasure = useRef(true)
  return { handoff, firstMeasure }
}

/** Move the indicator to `target`, playing the handoff slide when this is the
 *  first measure after a claim: the frame paints where the outgoing bar left
 *  the underline, then the bar is armed and released to slide home. Returns the
 *  calling layout effect's cleanup.
 *
 *  Double rAF on purpose — a single one fires before the pending first paint,
 *  so the handoff position would never commit and the transition would have no
 *  start value. */
export function applyTabIndicator(opts: {
  handoff: IndicatorRect | null
  target: IndicatorRect
  firstMeasure: RefObject<boolean>
  setIndicator: (rect: IndicatorRect) => void
  setArmed: (armed: boolean) => void
}): (() => void) | undefined {
  const { handoff, target, firstMeasure, setIndicator, setArmed } = opts
  const moved =
    !!handoff &&
    (Math.abs(handoff.left - target.left) > 1 || Math.abs(handoff.width - target.width) > 1)

  if (!firstMeasure.current || !moved) {
    firstMeasure.current = false
    setIndicator(target)
    return undefined
  }

  firstMeasure.current = false
  setIndicator(handoff)
  let done = false
  let inner = 0
  const outer = requestAnimationFrame(() => {
    inner = requestAnimationFrame(() => {
      done = true
      setArmed(true)
      setIndicator(target)
    })
  })
  return () => {
    cancelAnimationFrame(outer)
    cancelAnimationFrame(inner)
    // A cancelled in-flight handoff re-arms the latch: StrictMode runs the
    // effect mount→cleanup→mount, and without this the second pass would snap
    // the underline straight to the target.
    if (!done) firstMeasure.current = true
  }
}
