'use client'

// Expansion state for a notes tree, extracted from NoteSidebar so the docked
// sidebar and the full-screen Context explorer share one model — and one
// persisted blob, so a folder opened in either surface is open in both.
//
// Three layers compose into what's actually open:
//   openPaths       — what the user opened by hand, persisted per scope.
//   revealPath      — a transient peek (search focus, profile navigation) that
//                     expands a note's folder chain WITHOUT touching openPaths;
//                     clearing it snaps back to exactly the hand-opened set.
//   suppressedPaths — a folder collapsed while it was only open because of a
//                     reveal: openPaths has nothing to remove, so the collapse
//                     is recorded here and dropped when the reveal moves on.
//
// The tree opens fully COLLAPSED except the root: a real brain has hundreds of
// entity notes, and an all-open tree buries the top-level structure under them.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ancestorFolders } from '@/lib/notes/shared/indexNote'

export const ROOT_PATH = ''
const OPEN_STORE_PREFIX = 'visvine:notes-tree-open:'

/** The Trash row's expansion key. Not a real brain path (a note can never live
 *  at a `:` prefix — sanitizePath strips it), so it shares openPaths without
 *  ever colliding with a folder. */
export const TRASH_PATH = ':trash:'

/** Every folder on the way down to `path`, root row included:
 *  'people/acme/index.md' → ['', 'people', 'people/acme']. */
export function ancestorChain(path: string): string[] {
  return [ROOT_PATH, ...ancestorFolders(path)]
}

function readOpenPaths(storageKey: string | null): Set<string> {
  if (!storageKey || typeof window === 'undefined') return new Set([ROOT_PATH])
  try {
    const raw = window.localStorage.getItem(OPEN_STORE_PREFIX + storageKey)
    if (!raw) return new Set([ROOT_PATH])
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set([ROOT_PATH])
  } catch {
    return new Set([ROOT_PATH])
  }
}

export interface ContextTreeState {
  /** What the user opened by hand (persisted). */
  openPaths: Set<string>
  /** openPaths + the reveal overlay − suppressed collapses: render from this. */
  effectiveOpenPaths: Set<string>
  /** Toggle a folder row. Pass its CURRENT open state (from effectiveOpenPaths). */
  toggleFolder: (path: string, isOpen: boolean) => void
}

export function useContextTreeState(
  storageKey: string | null,
  revealPath: string | null,
  /** Extra paths to hold open (the explorer's search prune force-expands the
   *  matched chains). Same transient contract as revealPath: layered over
   *  openPaths, never persisted, and a manual collapse still wins. */
  forceOpen?: Set<string> | null,
): ContextTreeState {
  const [openPaths, setOpenPaths] = useState<Set<string>>(() => readOpenPaths(storageKey))

  // Re-read when the scope changes (switching communities swaps the whole tree).
  const lastKeyRef = useRef(storageKey)
  useEffect(() => {
    if (lastKeyRef.current === storageKey) return
    lastKeyRef.current = storageKey
    setOpenPaths(readOpenPaths(storageKey))
  }, [storageKey])

  useEffect(() => {
    if (!storageKey || typeof window === 'undefined') return
    try {
      window.localStorage.setItem(OPEN_STORE_PREFIX + storageKey, JSON.stringify([...openPaths]))
    } catch {
      // Private mode / quota — expansion just stops persisting.
    }
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

  return { openPaths, effectiveOpenPaths, toggleFolder }
}
