'use client'

// Expansion state for the docked notes tree (NoteSidebar).
//
// It is NOT persisted. Opening Context always starts the way the tree reads
// best — the space root open, one layer of folders under it — rather than
// restoring whatever chain was open days ago, which arrived as a wall of rows
// nobody asked for and made the tab feel slow before a byte of it was useful.
// Within a visit the set is remembered in memory (the docked tree re-mounts on
// every navigation, so a hand-opened folder has to survive clicking a note),
// and leaving Context for another Directory view clears it — see
// `resetContextTreeState`, called from the Directory page.
//
// Three layers compose into what's actually open:
//   openPaths       — what the user opened by hand, for this visit.
//   revealPath      — a transient peek (search focus, profile navigation) that
//                     expands a note's folder chain WITHOUT touching openPaths;
//                     clearing it snaps back to exactly the hand-opened set.
//   suppressedPaths — a folder collapsed while it was only open because of a
//                     reveal: openPaths has nothing to remove, so the collapse
//                     is recorded here and dropped when the reveal moves on.
//
// The tree opens fully COLLAPSED except the root: a real context has hundreds of
// entity notes, and an all-open tree buries the top-level structure under them.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ancestorFolders } from '@/lib/notes/shared/indexNote'
import { MAIN_PATH } from '@/lib/notes/shared/rootTiers'
import { isFederatedPath } from '@/lib/spaces/subspaces'

const ROOT_PATH = ''

/** What a tree opens at: the space row, and nothing else. A space with rooms
 *  draws `Main` beside them (lib/notes/shared/rootTiers.ts), and that tier
 *  starts SHUT too — the tiers are the shape of the space, and opening one of
 *  them buries the others under a namespace list nobody asked for. A reveal
 *  still opens Main on its way down (ancestorChain). */
const INITIAL_OPEN = [ROOT_PATH]

// Per-space expansion for the current visit. A module-level map, not
// localStorage and not component state: the tree re-mounts on every navigation
// (so state alone would collapse the tree whenever a note is clicked) but a
// reload, or a trip out to the grid, should start from the root again.
const visitOpen = new Map<string, Set<string>>()

// Where the tree was scrolled to, per scope, for the same reason and the same
// lifetime as the expansion above: the docked tree re-mounts on every
// navigation, and a fresh scroll container starts at 0 — so clicking a note
// half-way down would snap the list to the top and smooth-scroll back.
export const treeScrollMemory = new Map<string, number>()

/** Forget every space's expansion — the tree opens at its root next time.
 *  Called when a Directory view that is not Context mounts, which is what makes
 *  entering Context a fresh, one-layer tree. */
export function resetContextTreeState(): void {
  visitOpen.clear()
  treeScrollMemory.clear()
}

/** The Trash row's expansion key. Not a real context path (a note can never live
 *  at a `:` prefix — sanitizePath strips it), so it shares openPaths without
 *  ever colliding with a folder. */
export const TRASH_PATH = ':trash:'

/** Every folder on the way down to `path`, root row included:
 *  'people/acme/index.md' → ['', ':main:', 'people', 'people/acme'].
 *  A path of the space's OWN is drawn inside `Main`, so a reveal that does not
 *  open it stops one row short of what it was revealing. Another space's
 *  context is drawn beside Main, never in it. */
function ancestorChain(path: string): string[] {
  const tier = isFederatedPath(path) ? [] : [MAIN_PATH]
  return [ROOT_PATH, ...tier, ...ancestorFolders(path)]
}

function readOpenPaths(storageKey: string | null): Set<string> {
  if (!storageKey) return new Set(INITIAL_OPEN)
  return new Set(visitOpen.get(storageKey) ?? INITIAL_OPEN)
}

export interface ContextTreeState {
  /** What the user opened by hand, this visit. */
  openPaths: Set<string>
  /** openPaths + the reveal overlay − suppressed collapses: render from this. */
  effectiveOpenPaths: Set<string>
  /** Toggle a folder row. Pass its CURRENT open state (from effectiveOpenPaths). */
  toggleFolder: (path: string, isOpen: boolean) => void
  /** Hold a folder open by hand, whatever it was before. Opening a folder's home
   *  note goes through here rather than toggleFolder: the folder may already
   *  LOOK open on a reveal it is about to lose (selecting the folder's note
   *  moves the reveal off the child chain that was holding it), and only a real
   *  openPaths entry survives that. */
  openFolder: (path: string) => void
}

export function useContextTreeState(
  storageKey: string | null,
  revealPath: string | null,
  /** Extra paths to hold open (the explorer's search prune force-expands the
   *  matched chains). Same transient contract as revealPath: layered over
   *  openPaths, never remembered, and a manual collapse still wins. */
  forceOpen?: Set<string> | null,
): ContextTreeState {
  const [openPaths, setOpenPaths] = useState<Set<string>>(() => readOpenPaths(storageKey))

  // Re-read when the scope changes (switching spaces swaps the whole tree).
  const lastKeyRef = useRef(storageKey)
  useEffect(() => {
    if (lastKeyRef.current === storageKey) return
    lastKeyRef.current = storageKey
    setOpenPaths(readOpenPaths(storageKey))
  }, [storageKey])

  useEffect(() => {
    if (!storageKey) return
    visitOpen.set(storageKey, openPaths)
  }, [openPaths, storageKey])

  const revealedPaths = useMemo(
    () => (revealPath ? new Set(ancestorChain(revealPath)) : null),
    [revealPath],
  )

  const [suppressedPaths, setSuppressedPaths] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    setSuppressedPaths((prev) => (prev.size === 0 ? prev : new Set()))
  }, [revealPath])

  const effectiveOpenPaths = useMemo(() => {
    const overlay = forceOpen?.size ? forceOpen : null
    if (!revealedPaths && !overlay && suppressedPaths.size === 0) return openPaths
    const next = new Set(openPaths)
    if (revealedPaths) for (const p of revealedPaths) next.add(p)
    if (overlay) for (const p of overlay) next.add(p)
    for (const p of suppressedPaths) next.delete(p)
    return next
  }, [openPaths, revealedPaths, forceOpen, suppressedPaths])

  const toggleFolder = useCallback((path: string, isOpen: boolean) => {
    setOpenPaths((prev) => {
      const next = new Set(prev)
      if (isOpen) next.delete(path)
      else next.add(path)
      return next
    })
    setSuppressedPaths((prev) => {
      const next = new Set(prev)
      if (isOpen) next.add(path)
      else next.delete(path)
      return next
    })
  }, [])

  const openFolder = useCallback((path: string) => {
    setOpenPaths((prev) => (prev.has(path) ? prev : new Set(prev).add(path)))
    setSuppressedPaths((prev) => {
      if (!prev.has(path)) return prev
      const next = new Set(prev)
      next.delete(path)
      return next
    })
  }, [])

  return { openPaths, effectiveOpenPaths, toggleFolder, openFolder }
}
