"use client";

import { createContext, useContext, useState, ReactNode } from "react";

interface HeaderContextValue {
  headerContent: ReactNode;
  setHeaderContent: (content: ReactNode) => void;
}

const HeaderContext = createContext<HeaderContextValue>({
  headerContent: null,
  setHeaderContent: () => {},
});

export function HeaderProvider({ children }: { children: ReactNode }) {
  const [headerContent, setHeaderContent] = useState<ReactNode>(null);
  return (
    <HeaderContext.Provider value={{ headerContent, setHeaderContent }}>
      {children}
    </HeaderContext.Provider>
  );
}

export function useHeader() {
  return useContext(HeaderContext);
}
