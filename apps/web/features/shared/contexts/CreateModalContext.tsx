'use client';

import { useCallback, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSpace } from './SpaceContext';
import { createSafeContext } from './createSafeContext';
import { flowFor, rowForKind, type CreateKind } from '@/lib/create/rows';
import type { SpaceFeatureConfig } from '@/lib/types';

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
  // A scheduled agent, written as agents/<name>/index.md — any member may
  // author one and turn it on (lib/agents/config.ts).
  | 'agent'
  // A Tool — a folder of notes under tools/<name>/ scaffolded by
  // lib/tools/service.ts#createTool; any member may author one, an admin
  // publishes it.
  | 'tool';

export interface CreateOpenOptions {
  /** A folder the caller was standing in, for the kinds that land in one. */
  folder?: string | null;
}

interface CreateModalContextValue {
  /** The Create panel is out beside the rail. */
  isOpen: boolean;
  /** A kind to open straight onto, skipping the list. */
  defaultType: CreateKind | null;
  defaultFolder: string | null;
  open: (type?: CreateKind, opts?: CreateOpenOptions) => void;
  close: () => void;
  /** A form is being filled in. The panel opens under the pointer and shuts
   *  when the pointer leaves the rail's card (Sidebar); while someone is
   *  typing into a form, leaving must not throw that away, so the card holds
   *  the panel until the form is done or Escape steps back to the list. */
  formOpen: boolean;
  setFormOpen: (v: boolean) => void;
}

const [CreateModalContext, useCreateModal] = createSafeContext<CreateModalContextValue>('CreateModal');
export { useCreateModal };

export function CreateModalProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [defaultType, setDefaultType] = useState<CreateKind | null>(null);
  const [defaultFolder, setDefaultFolder] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const open = useCallback((type?: CreateKind, opts?: CreateOpenOptions) => {
    setDefaultType(type ?? null);
    setDefaultFolder(opts?.folder ?? null);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setDefaultType(null);
    setDefaultFolder(null);
    setFormOpen(false);
  }, []);

  return (
    <CreateModalContext.Provider value={{ isOpen, defaultType, defaultFolder, open, close, formOpen, setFormOpen }}>
      {children}
    </CreateModalContext.Provider>
  );
}

/**
 * The one entry point call sites should use: say what you want to create and
 * the flow table (lib/create/rows.ts) decides whether that is a form in the
 * panel, the kind's own surface, or the context-note draft. With no type the
 * panel opens on its list.
 */
export function useCreateSurface() {
  const router = useRouter();
  const pathname = usePathname();
  const { open } = useCreateModal();
  const { currentSpace, isAdmin } = useSpace();

  return useCallback(
    (type?: CreateKind, opts?: CreateOpenOptions) => {
      if (!type) {
        open(undefined, opts);
        return;
      }
      const row = rowForKind(type, {
        featureConfig: (currentSpace?.featureConfig as SpaceFeatureConfig | undefined) ?? null,
        isAdmin,
        spaceNodeTypes: currentSpace?.nodeTypes,
        pathname,
      });
      // Not offered here (feature off, not an admin): the list says so.
      if (!row) {
        open(undefined, opts);
        return;
      }
      const flow = flowFor(row, { pathname: pathname ?? '/', folder: opts?.folder });
      if (flow.kind === 'inline') open(type, opts);
      else router.push(flow.href);
    },
    [open, router, pathname, currentSpace, isAdmin],
  );
}
