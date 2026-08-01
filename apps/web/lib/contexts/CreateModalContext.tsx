'use client';

import { useCallback, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { createSafeContext } from './createSafeContext';
import { suggestedCreateType } from '@/lib/create/suggestedType';

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
  | 'file'
  // A gateway to an external API or database, written as connectors/<name>.md.
  // Admin-only, and the note IS the config — see lib/connectors/config.ts.
  | 'connector';

/**
 * Types that are created on the note-first surface (/directory/new) rather than
 * in the docked panel: everything that IS a context note. The panel keeps the
 * four that aren't — a channel, a space, a community and an uploaded file have
 * no note to open, so there is nothing for the draft surface to render.
 */
const NOTE_FIRST: Partial<Record<CreateableType, string>> = {
  context: 'note',
  person: 'person',
  organization: 'group',
  resource: 'resource',
};

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

/**
 * The one entry point call sites should use: it knows which types open the
 * note-first surface and which open the docked panel, so a caller just says
 * what it wants to create.
 *
 * `createSurface()` with no type opens a blank draft — pressing "+" should land
 * you on an empty note, not on a menu of decisions.
 */
export function useCreateSurface() {
  const router = useRouter();
  const pathname = usePathname();
  const { open } = useCreateModal();

  return useCallback(
    (type?: CreateableType, opts?: { folder?: string }) => {
      // With no explicit type, the page you're on picks the likely one — the
      // draft still opens blank and freely changeable, the Type row just starts
      // on Person from the directory rather than unset.
      const implied = type ?? suggestedCreateType(pathname)?.types.find((t) => t in NOTE_FIRST);
      const draftType = implied ? NOTE_FIRST[implied] : null;
      if (type && !draftType) {
        open(type);
        return;
      }
      const params = new URLSearchParams();
      if (draftType) params.set('type', draftType);
      if (opts?.folder) params.set('folder', opts.folder);
      const query = params.toString();
      router.push(`/directory/new${query ? `?${query}` : ''}`);
    },
    [open, pathname, router],
  );
}
