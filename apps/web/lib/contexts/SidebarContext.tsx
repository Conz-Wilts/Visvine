"use client";

import { createContext, useContext, useEffect, useState, ReactNode, type CSSProperties } from "react";
import { prefersReducedMotion } from "@/lib/motion";

interface SidebarContextValue {
  expanded: boolean;
  setExpanded: (v: boolean) => void;
  /** True once the shell's one-time entrance animation should be in its settled
   *  state. Shared by the Navbar + Sidebar so the whole L-shell flows in together. */
  entered: boolean;
  /** Honours prefers-reduced-motion — consumers collapse transitions to 0s. */
  reduced: boolean;
}

/**
 * One shared entrance recipe for the whole navbar + sidebar shell, so both
 * pieces settle in with identical timing and easing and read as one object
 * flowing into place. `transform` uses a gentle overshoot spring; `opacity`
 * a plain ease-out that finishes a touch earlier.
 */
export const SHELL_ENTRANCE = {
  spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  transformDur: "0.55s",
  opacityDur: "0.4s",
  /** Combined transition string for elements that translate + fade in. */
  transition: "transform 0.55s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.4s ease-out",
};

/**
 * The shared entrance style for both shell pieces. Both drift in diagonally from
 * the top-left by the same offset and fade, so the navbar + rail move as ONE rigid
 * L — the inner corner (and its fillet) stays perfectly joined throughout the
 * animation. Collapses to a settled, motionless state when reduced-motion is preferred.
 */
export function shellEntranceStyle(entered: boolean, reduced: boolean): CSSProperties {
  if (reduced) return { transform: "none", opacity: 1 };
  return {
    transform: entered ? "translate(0, 0)" : "translate(-52px, -40px)",
    opacity: entered ? 1 : 0,
    transition: SHELL_ENTRANCE.transition,
  };
}

const SidebarContext = createContext<SidebarContextValue>({
  expanded: false,
  setExpanded: () => {},
  entered: true,
  reduced: false,
});

// Module-level so the entrance plays once per session (a full page load), not on
// every client navigation between authed pages.
const hasAnimatedRef = { current: false };

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const [entered, setEntered] = useState(hasAnimatedRef.current);
  const [reduced, setReduced] = useState(false);

  useEffect(() => setReduced(prefersReducedMotion()), []);

  useEffect(() => {
    if (hasAnimatedRef.current) return;
    const t = setTimeout(() => {
      setEntered(true);
      hasAnimatedRef.current = true;
    }, 120);
    return () => clearTimeout(t);
  }, []);

  return (
    <SidebarContext.Provider value={{ expanded, setExpanded, entered, reduced }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  return useContext(SidebarContext);
}
