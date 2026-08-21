'use client';

import { useCallback, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { createSafeContext } from './createSafeContext';
import { suggestedCreateType } from '@/lib/create/suggestedType';

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
  | 'index'
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
 * Types that are created on the note-first surface (/directory/new) rather than
 * in the docked panel — which is now everything except an Event (whose detail
 * route redirects to /events/<id>, so the draft has nowhere to land).
 *
 * A channel, section and uploaded file used to be panel-only on the grounds that
 * they have no note to open. They do: each writes a context note
 * (channels/<slug>.md, spaces/…) or lands in the context tree,
 * so the draft surface takes a name and a starting body for them just like the
 * rest. The docked panel is still reachable from the places that open it
 * directly (the space switcher, the channel list) — it just isn't the only
 * way to reach these types any more.
 */
const NOTE_FIRST: Partial<Record<CreateableType, string>> = {
  context: 'note',
  index: 'index',
  person: 'person',
  space: 'space',
  resource: 'resource',
  connector: 'connector',
  // An agent stays in the docked panel: its form asks for the model, the
  // connectors and the folder of agents it lands in — the draft surface has no
  // agent type.
  channel: 'channel',
  section: 'section',
  file: 'file',
};

export interface CreateOpenOptions {
  /** The folder the new note should land in — for an agent, relative to `agents/`. */
  folder?: string;
}

interface CreateModalContextValue {
  isOpen: boolean;
  defaultType: CreateableType | null;
  defaultFolder: string | null;
  open: (type?: CreateableType, opts?: CreateOpenOptions) => void;
  close: () => void;
}

const [CreateModalContext, useCreateModal] = createSafeContext<CreateModalContextValue>('CreateModal');
export { useCreateModal };

export function CreateModalProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [defaultType, setDefaultType] = useState<CreateableType | null>(null);
  const [defaultFolder, setDefaultFolder] = useState<string | null>(null);

  const open = (type?: CreateableType, opts?: CreateOpenOptions) => {
    setDefaultType(type ?? null);
    setDefaultFolder(opts?.folder ?? null);
    setIsOpen(true);
  };

  const close = () => {
    setIsOpen(false);
    setDefaultType(null);
    setDefaultFolder(null);
  };

  return (
    <CreateModalContext.Provider value={{ isOpen, defaultType, defaultFolder, open, close }}>
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
        open(type, opts);
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
