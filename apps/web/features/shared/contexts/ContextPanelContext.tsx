"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { DOCK_MS } from "@/features/shared/contexts/SidebarContext";

/*
 * Bridges panel-owning pages and the global Sidebar so page content can render
 * INSIDE the Sidebar component — the icon rail + panel then read as one
 * connected card. The Sidebar exposes a portal host (`setHost`) inside its
 * docked card; the page owns the panel data and renders into that host via
 * createPortal (e.g. the /channels list or the /admin console sections).
 * The docks themselves are pathname-gated in the Sidebar.
 */
interface ContextPanelValue {
  host: HTMLElement | null;
  setHost: (el: HTMLElement | null) => void;
  // A query-param-gated route (the directory Context tab) can't be pathname-docked
  // in the Sidebar like /channels, so it raises this flag instead: it marks the
  // notes tree as AVAILABLE to dock. Whether the panel column actually opens is
  // the user's call via `contextOpen` below.
  dockRequested: boolean;
  setDockRequested: (v: boolean) => void;
  // Immediate release, skipping the DOCK_RELEASE_MS grace below — for moves
  // where nothing will re-claim the dock, so the grace would only hold the
  // panel open over a page with no dock inset.
  releaseDockNow: () => void;
  // User intent: the docked panel starts OPEN and can be closed from the
  // navbar's panel toggle. Lives here so it survives page-to-page navigation
  // within a session; a fresh load starts open again.
  contextOpen: boolean;
  setContextOpen: (v: boolean) => void;
  // The connections rail on the note surfaces (NoteContextPanel /
  // EntityContextPanel): the same ContextLinksPanel the 3-column browser shows,
  // as a toggleable right-hand column. Lives here — not in either panel — so it
  // survives note→note and note↔entity navigation the way `contextOpen` does.
  // No grace timers: the rail is mounted once by PaneSurfaceHost, so nothing
  // unmounts/remounts it across those swaps.
  connectionsOpen: boolean;
  setConnectionsOpen: (v: boolean) => void;
  // Pixels the docked panel's content should start BELOW the card top. A page
  // that keeps its own bar pinned at the card top (the Directory's Grid/Context
  // tabs) sets this to that bar's height so the notes tree begins under
  // it instead of being covered. Defaults to 0 — most docks fill from the top.
  dockTopInset: number;
  setDockTopInset: (v: number) => void;
}

const ContextPanelContext = createContext<ContextPanelValue>({
  host: null,
  setHost: () => {},
  dockRequested: false,
  setDockRequested: () => {},
  releaseDockNow: () => {},
  contextOpen: true,
  setContextOpen: () => {},
  connectionsOpen: false,
  setConnectionsOpen: () => {},
  dockTopInset: 0,
  setDockTopInset: () => {},
});

// Handing the dock BACK is deferred by this long. Navigating between two docked
// surfaces (the context canvas → a note, a note → another note) unmounts one
// ContextSidebar before the next one mounts, so a synchronous false→true would
// slam the panel column shut and slide it open again mid-navigation — the flash
// the transition reads as. The grace window swallows that gap; a real exit still
// collapses a beat later, which is invisible against the page swap. The same
// rule applies to dockTopInset: a page's cleanup resets it to 0 just before the
// next page sets its own, and without the grace the tree jumps to the card top
// and back down.
const DOCK_RELEASE_MS = 260;

export function ContextPanelProvider({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [dockRequestedState, setDockRequestedState] = useState(false);
  const [contextOpen, setContextOpen] = useState(true);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [dockTopInsetState, setDockTopInsetState] = useState(0);

  // One timer per latched value: claiming cancels a pending release.
  const dockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (dockTimer.current) clearTimeout(dockTimer.current);
      if (insetTimer.current) clearTimeout(insetTimer.current);
    },
    [],
  );

  const setDockRequested = useCallback((v: boolean) => {
    if (dockTimer.current) {
      clearTimeout(dockTimer.current);
      dockTimer.current = null;
    }
    if (v) {
      setDockRequestedState(true);
      return;
    }
    dockTimer.current = setTimeout(() => {
      dockTimer.current = null;
      setDockRequestedState(false);
    }, DOCK_RELEASE_MS);
  }, []);

  const releaseDockNow = useCallback(() => {
    if (dockTimer.current) {
      clearTimeout(dockTimer.current);
      dockTimer.current = null;
    }
    // dockTopInset is deliberately not reset here: the closing column's white
    // starts below the bar by exactly this inset, so zeroing it mid-close would
    // slide that white up into the bar's band. It drains through its own graced
    // path when the bar goes away.
    setDockRequestedState(false);
  }, []);

  const setDockTopInset = useCallback((v: number) => {
    if (insetTimer.current) {
      clearTimeout(insetTimer.current);
      insetTimer.current = null;
    }
    if (v > 0) {
      setDockTopInsetState(v);
      return;
    }
    insetTimer.current = setTimeout(() => {
      insetTimer.current = null;
      setDockTopInsetState(0);
    }, DOCK_RELEASE_MS);
  }, []);

  return (
    <ContextPanelContext.Provider
      value={{
        host,
        setHost,
        dockRequested: dockRequestedState,
        setDockRequested,
        releaseDockNow,
        contextOpen,
        setContextOpen,
        connectionsOpen,
        setConnectionsOpen,
        dockTopInset: dockTopInsetState,
        setDockTopInset,
      }}
    >
      {children}
    </ContextPanelContext.Provider>
  );
}

export function useContextPanel() {
  return useContext(ContextPanelContext);
}

/*
 * True while the docked panel column is visible, not just requested. The dock
 * releases in two lagged stages (the DOCK_RELEASE_MS grace above, then the
 * DOCK_MS width animation in the Sidebar), so anything stacked relative to the
 * panel must hold its state through both or the closing panel paints over it.
 */
export function useDockVisuallyOpen() {
  const { dockRequested, contextOpen } = useContextPanel();
  const open = dockRequested && contextOpen;
  const [visuallyOpen, setVisuallyOpen] = useState(open);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (open) {
      setVisuallyOpen(true);
      return;
    }
    // dockRequested already lagged by DOCK_RELEASE_MS; hold through the width
    // animation that starts when it flips (small buffer for paint jitter).
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setVisuallyOpen(false);
    }, DOCK_MS + 50);
    return () => {
      if (closeTimer.current) {
        clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
    };
  }, [open]);
  return visuallyOpen;
}
