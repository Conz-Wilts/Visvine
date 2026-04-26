"use client";

import { createContext, useContext, useState, ReactNode } from "react";

interface SidebarContextValue {
  expanded: boolean;
  setExpanded: (v: boolean) => void;
}

const SidebarContext = createContext<SidebarContextValue>({
  expanded: false,
  setExpanded: () => {},
});

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <SidebarContext.Provider value={{ expanded, setExpanded }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  return useContext(SidebarContext);
}
