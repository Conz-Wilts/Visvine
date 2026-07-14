"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

/*
 * Bridges panel-owning pages and the global Sidebar so page content can render
 * INSIDE the Sidebar component — the icon rail + panel then read as one
 * connected card. The Sidebar exposes a portal host (`setHost`) inside its
 * docked card; the page owns the panel data and renders into that host via
 * createPortal (e.g. the /channels list or the /admin console sections).
 * `collapsed` is shared so the Sidebar hides the panel column and the page
 * reclaims the freed horizontal space in lockstep. The docks themselves are
 * pathname-gated in the Sidebar.
 */
interface ContextPanelValue {
  host: HTMLElement | null;
  setHost: (el: HTMLElement | null) => void;
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  // A query-param-gated route (the directory graph view) can't be pathname-docked
  // in the Sidebar like /channels, so it raises this flag instead: the Sidebar
  // opens its panel column and the requesting page portals its tree into the host.
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
