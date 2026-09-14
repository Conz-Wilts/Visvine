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
  defaultFolder: string | null;
  /**
   * Opens the panel. A `type` is what the caller WANTED to make; the panel
   * itself only lists, so this is carried no further than `useCreateSurface`,
   * which routes to the type's surface when the space offers it and falls
   * back to opening the list when it doesn't.
   */
  open: (type?: CreateKind, opts?: CreateOpenOptions) => void;
  close: () => void;
}

const [CreateModalContext, useCreateModal] = createSafeContext<CreateModalContextValue>('CreateModal');
export { useCreateModal };

export function CreateModalProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [defaultFolder, setDefaultFolder] = useState<string | null>(null);

  const open = useCallback((_type?: CreateKind, opts?: CreateOpenOptions) => {
    setDefaultFolder(opts?.folder ?? null);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setDefaultFolder(null);
  }, []);

  return (
    <CreateModalContext.Provider value={{ isOpen, defaultFolder, open, close }}>
      {children}
    </CreateModalContext.Provider>
  );
}

/**
 * The one entry point call sites should use: say what you want to create and
 * the flow table (lib/create/rows.ts) decides whether that is the kind's own
 * surface or the draft. Either way it is a navigation — nothing is filled in
 * beside the rail. With no type the panel opens on its list.
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
      router.push(flowFor(row, { folder: opts?.folder }).href);
    },
    [open, router, pathname, currentSpace, isAdmin],
  );
}
