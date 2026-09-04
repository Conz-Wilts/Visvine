"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { prefersReducedMotion } from "@/lib/motion";

interface SidebarContextValue {
  /** Whether the rail is open. The rail has no switch: it opens under the
   *  pointer and closes when you leave it, so it is never a thing to put away.
   *  The shell's switch belongs to the surface's own side panel — the context
   *  tree, the channel list — see ContextPanelContext. */
  expanded: boolean;
  /** Pointer is over the rail: it opens for as long as you are on it. */
  setHovered: (v: boolean) => void;
  /** Honours prefers-reduced-motion — consumers collapse transitions to 0s. */
  reduced: boolean;
  /** The space switcher is open in the rail's panel column — the search and
   *  the list of every space you are in, slid out beside the rail the way
   *  Create new is (SpaceSwitcherPanel). Opened from the space at the rail's
   *  head; the Sidebar owns the column it slides into. */
  switcherOpen: boolean;
  setSwitcherOpen: (v: boolean) => void;
  /** The space in the switcher whose sub-spaces are showing, in the column
   *  beside it (SubspacePanel). The switcher's rows set it on hover, and the
   *  Sidebar owns that second column the way it owns the first — a sub-space
   *  list is another layer against the rail's edge, so it cannot be drawn
   *  inside the switcher's own clipped box. Null when nothing is open. */
  switcherParentId: string | null;
  setSwitcherParentId: (v: string | null) => void;
}

/** How long shutting the switcher takes from here, sub-space column and all:
 *  one column's slide, or two when the second one is out. The Sidebar waits
 *  this out before letting the rail underneath go. */
export function switcherCloseMs(subspaceColumnOpen: boolean, reduced: boolean): number {
  if (reduced) return 0;
  return subspaceColumnOpen ? DOCK_MS * 2 : DOCK_MS;
}

/**
 * Dock motion, shared by the Sidebar's panel column and the Create panel that
 * takes that column over: Create slides in (translateX) while the column widens,
 * and the two only stay glued together — no bare sliver at the leading edge — if
 * the duration and easing match exactly. Lives here rather than in Sidebar.tsx so
 * both sides can import it without a cycle (Sidebar renders CreateModal).
 */
export const DOCK_MS = 320;
/** Closing is faster than opening: an arriving panel glides in, but a leaving
 *  one should be out of the way before the destination's content (the grid's
 *  card cascade) is mid-animation beside it. */
export const DOCK_CLOSE_MS = 200;
export const DOCK_EASE = "cubic-bezier(0.25, 0.1, 0.25, 1)";

const SidebarContext = createContext<SidebarContextValue>({
  expanded: false,
  setHovered: () => {},
  reduced: false,
  switcherOpen: false,
  setSwitcherOpen: () => {},
  switcherParentId: null,
  setSwitcherParentId: () => {},
});

export function SidebarProvider({ children }: { children: ReactNode }) {
  // One way in, one state out: the rail opens while the pointer is on it. It is
  // the shell's own chrome — the space switcher and the tool list — so it costs
  // nothing to leave closed, and the switch in the top band opens the panel the
  // PAGE brought instead.
  const [hovered, setHovered] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switcherParentId, setParentId] = useState<string | null>(null);

  useEffect(() => setReduced(prefersReducedMotion()), []);

  // Shutting the switcher while its sub-space column is out is ONE motion
  // across both, not two at once: the outer column tucks back under the
  // switcher first, and only when it is home does the switcher itself leave.
  // Sliding both at the same moment opens a strip of bare page between them —
  // the switcher's box empties from its right edge while the column that
  // should be covering it is travelling too. So every close runs through here
  // rather than through the raw setter.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  useEffect(() => cancelClose, []);

  // Both setters below are handed out for the life of the provider, and what
  // they read of the current state comes through refs. A setter whose identity
  // changed with the state would re-fire every effect that lists it — the
  // switcher's own "close on navigation" among them, which would shut the
  // panel the moment a row of it opened the sub-space column.
  const parentRef = useRef<string | null>(null);
  parentRef.current = switcherParentId;
  const reducedRef = useRef(false);
  reducedRef.current = reduced;

  const setSwitcherOpenStaged = useCallback((v: boolean) => {
    cancelClose();
    if (v) return setSwitcherOpen(true);
    const hadColumn = parentRef.current !== null;
    setParentId(null);
    if (!hadColumn || reducedRef.current) return setSwitcherOpen(false);
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setSwitcherOpen(false);
    }, DOCK_MS);
  }, []);

  // Pointing at another parent mid-close is a change of mind: the switcher
  // stays, and the column that was leaving comes back with the new list.
  const setSwitcherParentId = useCallback((v: string | null) => {
    if (v !== null) cancelClose();
    setParentId(v);
  }, []);

  return (
    <SidebarContext.Provider value={{ expanded: hovered, setHovered, reduced, switcherOpen, setSwitcherOpen: setSwitcherOpenStaged, switcherParentId, setSwitcherParentId }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  return useContext(SidebarContext);
}
