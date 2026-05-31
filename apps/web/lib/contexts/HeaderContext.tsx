"use client";

import { createContext, useContext, useState, ReactNode } from "react";

interface HeaderContextValue {
  headerContent: ReactNode;
  setHeaderContent: (content: ReactNode) => void;
  headerRight: ReactNode;
  setHeaderRight: (content: ReactNode) => void;
}

const HeaderContext = createContext<HeaderContextValue>({
  headerContent: null,
  setHeaderContent: () => {},
  headerRight: null,
  setHeaderRight: () => {},
});

export function HeaderProvider({ children }: { children: ReactNode }) {
  const [headerContent, setHeaderContent] = useState<ReactNode>(null);
  const [headerRight, setHeaderRight] = useState<ReactNode>(null);
  return (
    <HeaderContext.Provider value={{ headerContent, setHeaderContent, headerRight, setHeaderRight }}>
      {children}
    </HeaderContext.Provider>
  );
}

export function useHeader() {
  return useContext(HeaderContext);
}
