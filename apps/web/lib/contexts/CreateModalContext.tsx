'use client';

import { useState } from 'react';
import { createSafeContext } from './createSafeContext';

export type CreateableType =
  | 'person'
  | 'organization'
  | 'resource'
  | 'event'
  | 'community'
  | 'channel'
  | 'space'
  // Brain surfaces: a written note, and an uploaded file ingested as a Context
  // Source. Both land at a path in the current community's context.
  | 'context'
  | 'file';

interface CreateModalContextValue {
  isOpen: boolean;
  defaultType: CreateableType | null;
  open: (type?: CreateableType) => void;
  close: () => void;
}

const [CreateModalContext, useCreateModal] = createSafeContext<CreateModalContextValue>('CreateModal');
export { useCreateModal };

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
