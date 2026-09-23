"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
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
   *  the list of every space you are in, slid out beside the rail
   *  (SpaceSwitcherPanel). Opened from the space at the rail's
   *  head; the Sidebar owns the column it slides into. */
  switcherOpen: boolean;
  setSwitcherOpen: (v: boolean) => void;
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
});

export function SidebarProvider({ children }: { children: ReactNode }) {
  // One way in, one state out: the rail opens while the pointer is on it. It is
  // the shell's own chrome — the space switcher and the tool list — so it costs
  // nothing to leave closed, and the switch in the top band opens the panel the
  // PAGE brought instead.
  const [hovered, setHovered] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);

  useEffect(() => setReduced(prefersReducedMotion()), []);

  return (
    <SidebarContext.Provider value={{ expanded: hovered, setHovered, reduced, switcherOpen, setSwitcherOpen }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  return useContext(SidebarContext);
}
