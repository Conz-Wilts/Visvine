"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

/*
 * Bridges panel-owning pages and the global Sidebar so page content can render
 * INSIDE the Sidebar component — the icon rail + panel then read as one
 * connected card. The Sidebar exposes a portal host (`setHost`) inside its
 * docked card; the page owns the panel data and renders into that host via
 * createPortal (e.g. the notes tree from the directory's Context view).
 * `collapsed` is shared so the Sidebar hides the panel column and the page
 * reclaims the freed horizontal space in lockstep.
 *
 * `dockRequested` is the state-driven dock signal: a mounted view (the
 * directory's embedded notes workspace) asks the Sidebar to open the docked
 * column regardless of pathname — set true on mount, false on unmount. The
 * /channels and /admin docks remain pathname-gated in the Sidebar itself.
 */
interface ContextPanelValue {
  host: HTMLElement | null;
  setHost: (el: HTMLElement | null) => void;
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  dockRequested: boolean;
  setDockRequested: (v: boolean) => void;
}

const ContextPanelContext = createContext<ContextPanelValue>({
  host: null,
  setHost: () => {},
  collapsed: false,
  setCollapsed: () => {},
  dockRequested: false,
  setDockRequested: () => {},
});

export function ContextPanelProvider({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [dockRequested, setDockRequested] = useState(false);
  return (
    <ContextPanelContext.Provider
      value={{ host, setHost, collapsed, setCollapsed, dockRequested, setDockRequested }}
    >
      {children}
    </ContextPanelContext.Provider>
  );
}

export function useContextPanel() {
  return useContext(ContextPanelContext);
}
