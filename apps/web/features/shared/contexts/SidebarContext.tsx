"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { prefersReducedMotion } from "@/lib/motion";

interface SidebarContextValue {
  expanded: boolean;
  setExpanded: (v: boolean) => void;
  /** Honours prefers-reduced-motion — consumers collapse transitions to 0s. */
  reduced: boolean;
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

// The navbar + rail used to drift in diagonally on load behind a shared
// `shellEntranceStyle(entered, reduced)`. The entrance was cut for the colour
// frame — the shell is the frame's still backdrop now — so both the helper and
// the `entered` flag are gone rather than left returning a constant.

const SidebarContext = createContext<SidebarContextValue>({
  expanded: false,
  setExpanded: () => {},
  reduced: false,
});

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => setReduced(prefersReducedMotion()), []);

  return (
    <SidebarContext.Provider value={{ expanded, setExpanded, reduced }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  return useContext(SidebarContext);
}
