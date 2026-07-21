"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

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
  // User intent: the docked panel starts OPEN and can be closed from the
  // navbar's panel toggle. Lives here so it survives page-to-page navigation
  // within a session; a fresh load starts open again.
  contextOpen: boolean;
  setContextOpen: (v: boolean) => void;
  // Pixels the docked panel's content should start BELOW the card top. A page
  // that keeps its own bar pinned at the card top (the Directory's Grid/Graph/
  // Tables tabs) sets this to that bar's height so the notes tree begins under
  // it instead of being covered. Defaults to 0 — most docks fill from the top.
  dockTopInset: number;
  setDockTopInset: (v: number) => void;
}

const ContextPanelContext = createContext<ContextPanelValue>({
  host: null,
  setHost: () => {},
  dockRequested: false,
  setDockRequested: () => {},
  contextOpen: true,
  setContextOpen: () => {},
  dockTopInset: 0,
  setDockTopInset: () => {},
});

export function ContextPanelProvider({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [dockRequested, setDockRequested] = useState(false);
  const [contextOpen, setContextOpen] = useState(true);
  const [dockTopInset, setDockTopInset] = useState(0);
  return (
    <ContextPanelContext.Provider
      value={{ host, setHost, dockRequested, setDockRequested, contextOpen, setContextOpen, dockTopInset, setDockTopInset }}
    >
      {children}
    </ContextPanelContext.Provider>
  );
}

export function useContextPanel() {
  return useContext(ContextPanelContext);
}
