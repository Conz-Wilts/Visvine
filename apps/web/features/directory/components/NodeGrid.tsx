'use client'

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { VirtuosoGrid, type GridComponents } from 'react-virtuoso'
import NodeCard from './NodeCard'
import type { DirectoryItem } from '@/lib/types'
import type { NodeTypeConfig, SpaceAlias } from '@/lib/types'
import { EmptyState, Skeleton } from '@/components/ui'
import { prefersReducedMotion } from '@/lib/motion'

const GRID_STYLE: React.CSSProperties = {
  display: 'grid',
  // Fluid columns, not a fixed 260px: a fixed track left whatever the row
  // couldn't use as dead air between cards (space-evenly spread ~200px of it at
  // 1440), which reads as a broken grid. `minmax(230px, 1fr)` picks the column
  // count from the width and then divides the row exactly. The card's height
  // follows from its width (square media + a fixed-line content block), so every
  // cell in the grid is still the same size.
  gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
  gap: '20px',
  // Scopes the cards' hover z-index to the grid. A hovered card lifts above its
  // neighbours via `hover:z-10`, but the sticky toolbar is *also* z-10 and shares
  // a stacking context with the cards — and the reveal wrapper drops its
  // `card-rise` class (and with it its own stacking context) once the entrance
  // animation ends, so after that a hovered card would win on DOM order and slide
  // over the search bar. Isolating here keeps card-over-card working while the
  // whole grid stays behind the toolbar it scrolls under.
  isolation: 'isolate',
}

// useLayoutEffect on the client so the entrance state is set before paint (no
// flash); useEffect on the server to avoid React's SSR warning.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

// Delay between consecutive cards in a reveal cascade.
const STAGGER_STEP_MS = 45

function NodeCardSkeleton() {
  return (
    <div className="rounded-2xl overflow-hidden w-full flex flex-col bg-surface-1 border-4 border-surface-3">
      <Skeleton className="aspect-square w-full shrink-0 rounded-none" />
      <div className="px-4 pt-3 pb-4 flex flex-col flex-1 items-center">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="mt-2 h-3 w-full" />
        <Skeleton className="mt-1.5 h-3 w-2/3" />
        <Skeleton className="mt-3.5 h-5 w-20 rounded-md" />
      </div>
    </div>
  )
}

/**
 * Coordinates the staggered "rise" reveal across cards.
 *
 * VirtuosoGrid only mounts the cards in (or near) the viewport, so we can't use
 * the absolute list index for the stagger delay — a card at index 200 revealed
 * by scrolling would sit invisible for seconds. Instead we stagger by the order
 * in which cards mount *within a single animation frame*: the first screenful
 * cascades 0,1,2,…, and a later batch revealed by scrolling starts its own short
 * cascade from 0. Each id animates at most once; scrolling back to an
 * already-revealed card shows it instantly.
 */
function createRevealCoordinator() {
  const revealed = new Set<string>()
  let batch = 0
  let scheduled = false
  return {
    /** Returns the stagger order for a freshly-revealed card, or null if it has
     *  already been revealed (and should appear instantly). */
    claim(id: string): number | null {
      if (revealed.has(id)) return null
      revealed.add(id)
      const order = batch++
      if (!scheduled) {
        scheduled = true
        requestAnimationFrame(() => { batch = 0; scheduled = false })
      }
      return order
    },
    reset() {
      revealed.clear()
      batch = 0
      scheduled = false
    },
  }
}

type RevealCoordinator = ReturnType<typeof createRevealCoordinator>

// Wraps a card and plays the rise-in animation the first time it appears.
function RevealCard({ id, coordinator, children }: {
  id: string
  coordinator: RevealCoordinator
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)

  useIsoLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const order = coordinator.claim(id)
    if (order === null || prefersReducedMotion()) {
      el.style.opacity = '1'
      return
    }
    el.style.animationDelay = `${order * STAGGER_STEP_MS}ms`
    el.classList.add('card-rise')
    // `card-rise` uses `animation-fill-mode: both` to hold full opacity at the
    // end; pin it inline before dropping the class so the card stays visible.
    const done = () => { el.style.opacity = '1'; el.classList.remove('card-rise') }
    el.addEventListener('animationend', done, { once: true })
    return () => el.removeEventListener('animationend', done)
    // Claim exactly once per mount — id/coordinator are stable for a mounted card.
  }, [])

  return (
    <div ref={ref} style={{ opacity: 0 }}>
      {children}
    </div>
  )
}

// VirtuosoGrid renders its windowed items into this grid container.
const GridList = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  function GridList({ style, children, ...props }, ref) {
    return (
      <div ref={ref} {...props} style={{ ...style, ...GRID_STYLE }}>
        {children}
      </div>
    )
  }
)

// Cast through `unknown`: react-virtuoso resolves a second copy of @types/react,
// so its ref types are nominally distinct from the app's. The runtime contract
// is identical.
const gridComponents = {
  List: GridList,
  Item: ({ children, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
    <div {...props}>{children}</div>
  ),
} as unknown as GridComponents

interface DirectoryGridProps {
  items: DirectoryItem[]
  loading?: boolean
  onCardClick?: (item: DirectoryItem) => void
  nodeTypes?: NodeTypeConfig[]
  aliases?: SpaceAlias[]
}

export default function NodeGrid({ items, loading = false, onCardClick, nodeTypes, aliases }: DirectoryGridProps) {
  // One coordinator per mounted grid, reset whenever the result set changes so a
  // filter/search re-runs the cascade (mirrors the previous id-keyed behaviour).
  const coordinatorRef = useRef<RevealCoordinator | null>(null)
  if (!coordinatorRef.current) coordinatorRef.current = createRevealCoordinator()
  const coordinator = coordinatorRef.current

  // The page doesn't scroll on the window — the auth shell's <main> is the scroll
  // container. Point VirtuosoGrid at that element via customScrollParent; with
  // the window scroller (which never scrolls here) it only mounts the first
  // screenful of cards. We must resolve <main> BEFORE mounting VirtuosoGrid:
  // mounting it with an undefined parent makes Virtuoso build its own internal
  // scroller (which collapses to 0px inside our flex layout), and swapping the
  // prop afterwards doesn't tear that scroller down. So a sentinel resolves the
  // scroll parent in a layout effect and the grid stays gated until it's known.
  // Callback ref (not useEffect): the sentinel only mounts once data has loaded
  // and the grid branch renders, which is a later render than NodeGrid's first
  // mount. A [] effect would run before the sentinel exists and never re-run; a
  // callback ref fires exactly when the node attaches.
  const [scrollParent, setScrollParent] = useState<HTMLElement | null>(null)
  const sentinelCallbackRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return
    let el: HTMLElement | null = node.parentElement
    while (el) {
      const overflowY = getComputedStyle(el).overflowY
      if (overflowY === 'auto' || overflowY === 'scroll') break
      el = el.parentElement
    }
    setScrollParent(el)
  }, [])

  const idSignature = useMemo(() => items.map(i => i.id).join(','), [items])
  const prevSignatureRef = useRef<string | null>(null)
  // Derive-during-render reset so the coordinator is cleared before the new
  // cards' layout effects run (child effects fire before parent effects).
  if (idSignature !== prevSignatureRef.current) {
    prevSignatureRef.current = idSignature
    coordinator.reset()
  }

  if (loading) return (
    <div style={GRID_STYLE} className="w-full">
      {Array.from({ length: 12 }).map((_, i) => <NodeCardSkeleton key={i} />)}
    </div>
  )

  if (items.length === 0) {
    return <EmptyState title="No entries" description="No entries found. Try adjusting your filters." />
  }

  // Viewport-windowed grid: only the cards on screen are mounted. The sentinel
  // resolves the scroll parent; until it does, render skeletons (a layout effect
  // resolves it before the first paint, so this is effectively invisible).
  return (
    <>
      <div ref={sentinelCallbackRef} style={{ display: 'none' }} />
      {scrollParent === null ? (
        <div style={GRID_STYLE} className="w-full">
          {Array.from({ length: 12 }).map((_, i) => <NodeCardSkeleton key={i} />)}
        </div>
      ) : (
        <VirtuosoGrid
          customScrollParent={scrollParent}
          data={items}
          components={gridComponents}
          computeItemKey={(_, item) => item.id}
          // Mount a screen's worth past each edge so a flick never lands on
          // an empty row while the next batch mounts; the cards behind and
          // ahead of that are unmounted.
          increaseViewportBy={{ top: 400, bottom: 800 }}
          itemContent={(_, item) => (
            <RevealCard id={item.id} coordinator={coordinator}>
              <NodeCard item={item} onClick={onCardClick} nodeTypes={nodeTypes} aliases={aliases} />
            </RevealCard>
          )}
        />
      )}
    </>
  )
}
