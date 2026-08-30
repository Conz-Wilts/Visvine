'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSafeContext } from './createSafeContext';

export type CreateableType =
  | 'person'
  // A group, organisation or space recorded in the directory (the org node
  // type). A node and a note, in the space you're already
  // in. Provisioning a real space of your own is NOT a create type: it's the
  // one act that takes you somewhere else, and lives on the switcher instead
  // (features/spaces/components/NewSpaceDialog).
  | 'space'
  | 'resource'
  | 'event'
  | 'channel'
  // The channels-tool container.
  | 'section'
  // Context surfaces: a written note, and an uploaded file ingested as a Context
  // Source. Both land at a path in the current space's context.
  | 'context'
  | 'file'
  // A folder in the context — written as its index note, because an index note
  // IS a folder (lib/notes/shared/indexNote.ts). The title names the folder.
  | 'folder'
  // A gateway to an external API or database, written as connectors/<name>.md.
  // Admin-only, and the note IS the config — see lib/connectors/config.ts.
  | 'connector'
  // A scheduled agent, written as agents/<name>.md — any member may author one;
  // an admin activates it (lib/agents/config.ts).
  | 'agent'
  // A Tool — a folder of notes under tools/<name>/ scaffolded by
  // lib/tools/service.ts#createTool; any member may author one, an admin
  // publishes it. Not note-first: the scaffold writes three notes and a node
  // at once, so it stays in the docked panel.
  | 'tool';

/**
 * Types that are created on the note-first surface (/directory/new). Everything
 * is, except a Tool — its scaffold writes three notes and a node at once, so it
 * stays in the docked panel. A connector and an agent are ONLY creatable
 * here: the docked panel has no form for either.
 *
 * A channel, section and uploaded file each write a context note
 * (channels/<slug>.md, spaces/…) or land in the context tree, so the draft
 * surface takes a name and a starting body for them like the rest. The docked
 * panel is still reachable from the places that open it directly (the space
 * switcher, the channel list).
 */
const NOTE_FIRST: Partial<Record<CreateableType, string>> = {
  context: 'note',
  folder: 'folder',
  person: 'person',
  space: 'space',
  resource: 'resource',
  connector: 'connector',
  // An agent is a note like the rest: the title names it, the editor body is
  // the brief, and the model/connectors its runner needs are the draft's
  // inline extras.
  agent: 'agent',
  channel: 'channel',
  section: 'section',
  file: 'file',
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
    <CreateModalContext.Provider
      value={{
        isOpen,
        defaultType,
        open,
        close,
      }}
    >
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
  const { open } = useCreateModal();

  return useCallback(
    (type?: CreateableType, opts?: { folder?: string }) => {
      // With no explicit type the draft opens with the Type row UNSET. The route
      // used to imply one, which meant "Create new" from anywhere under
      // /directory started on Person — a type nobody asked for, on a surface
      // whose whole point is that you say what the thing is.
      const draftType = type ? NOTE_FIRST[type] : null;
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
    [open, router],
  );
}
