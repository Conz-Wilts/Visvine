import React, { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface SearchContextValue {
  query: string;
  setQuery: (q: string) => void;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  placeholder: string;
  setPlaceholder: (p: string) => void;
}

const SearchContext = createContext<SearchContextValue | undefined>(undefined);

export function SearchProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [placeholder, setPlaceholder] = useState('Search');

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => {
    setIsOpen(false);
    setQuery('');
  }, []);

  const value = useMemo(
    () => ({ query, setQuery, isOpen, open, close, placeholder, setPlaceholder }),
    [query, isOpen, open, close, placeholder]
  );

  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}

export function useSearch() {
  const ctx = useContext(SearchContext);
  if (!ctx) throw new Error('useSearch must be used within SearchProvider');
  return ctx;
}
