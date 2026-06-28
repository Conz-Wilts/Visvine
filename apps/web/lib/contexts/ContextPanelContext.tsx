"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

/*
 * Bridges the /context (notes) page and the global Sidebar so the notes tree can
 * render INSIDE the Sidebar component — the icon rail + tree then read as one
 * connected card. The Sidebar exposes a portal host (`setHost`) inside its docked
 * card; NotesWorkspace owns all the tree data and renders its <NoteSidebar> into
 * that host via createPortal. `collapsed` is shared so the Sidebar hides the tree
 * column and the page reclaims the freed horizontal space in lockstep.
 */
interface ContextPanelValue {
  host: HTMLElement | null;
  setHost: (el: HTMLElement | null) => void;
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
}

const ContextPanelContext = createContext<ContextPanelValue>({
  host: null,
  setHost: () => {},
  collapsed: false,
  setCollapsed: () => {},
});

export function ContextPanelProvider({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  return (
    <ContextPanelContext.Provider value={{ host, setHost, collapsed, setCollapsed }}>
      {children}
    </ContextPanelContext.Provider>
  );
}

export function useContextPanel() {
  return useContext(ContextPanelContext);
}
