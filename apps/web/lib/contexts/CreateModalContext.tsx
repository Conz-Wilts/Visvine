'use client';

import { createContext, useContext, useState } from 'react';

export type CreateableType = 'person' | 'organization' | 'resource' | 'event' | 'community' | 'context';

interface CreateModalContextValue {
  isOpen: boolean;
  defaultType: CreateableType | null;
  open: (type?: CreateableType) => void;
  close: () => void;
}

const CreateModalContext = createContext<CreateModalContextValue | null>(null);

export function CreateModalProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [defaultType, setDefaultType] = useState<CreateableType | null>(null);

  const open = (type?: CreateableType) => {
    setDefaultType(type ?? null);
    setIsOpen(true);
  };

  const close = () => {
    setIsOpen(false);
    setDefaultType(null);
  };

  return (
    <CreateModalContext.Provider value={{ isOpen, defaultType, open, close }}>
      {children}
    </CreateModalContext.Provider>
  );
}

export function useCreateModal() {
  const ctx = useContext(CreateModalContext);
  if (!ctx) throw new Error('useCreateModal must be used within CreateModalProvider');
  return ctx;
}
