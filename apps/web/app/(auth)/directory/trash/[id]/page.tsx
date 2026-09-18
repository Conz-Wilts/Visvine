'use client';

// Standalone trashed-note view: /directory/trash/<id> opens a soft-deleted note
// in the ordinary note surface — Context and Raw, the docked context tree
// beside it — read-only, with Restore and Delete forever where a live note
// carries Connections and Share.
//
// The note is out of the tree, the directory and search until it is restored;
// it is not out of reach. Deciding between the two acts means reading what is
// in it, so this is the note's page, minus the parts that only make sense for a
// note that is still in the graph.

import React, { Suspense, useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';
import { type NoteMode } from '@/features/notes/components/NoteModeToggle';
import { usePaneChrome, type PaneTabItem } from '@/features/shared/contexts/PaneShellContext';

// The one section every context note has; Raw is the bar's trailing toggle.
const TRASH_TABS: PaneTabItem[] = [{ id: 'context', label: 'Context' }];

const TrashPreviewPanel = dynamic(
  () => import('@/features/notes/components/TrashPreviewPanel').then((m) => m.TrashPreviewPanel),
  { ssr: false, loading: () => null },
);
const ContextSidebar = dynamic(
  () => import('@/features/notes/components/ContextSidebar').then((m) => m.ContextSidebar),
  { ssr: false, loading: () => null },
);

function TrashViewerRoute() {
  const params = useParams();
  const raw = params.id;
  const id = decodeURIComponent(String(Array.isArray(raw) ? raw[0] : (raw ?? '')));
  const [mode, setMode] = useState<NoteMode>('wysiwyg');
  const handleSelect = useCallback((next: string) => {
    // The bar's trailing Raw toggle, not a tab: flip the editor mode.
    if (next === 'raw') setMode((prev) => (prev === 'raw' ? 'wysiwyg' : 'raw'));
    else setMode('wysiwyg');
  }, []);

  // `surface: null` — this page draws its own body (the panel below) rather
  // than pointing the shell's note surface at a path, because a trashed note
  // has no live path to read. Registering explicitly is required either way
  // under the shell's hold-last-config store, or the previous page's bar and
  // note surface would stay on screen over this one. No attached region: the
  // editor is read-only, so there is no toolbar to hang there.
  usePaneChrome({
    tabs: TRASH_TABS,
    activeId: 'context',
    onSelect: handleSelect,
    attachedOpen: false,
    rawToggle: mode === 'raw' ? 'on' : true,
    ariaLabel: 'Note sections',
    surface: null,
  });

  return (
    <div className="profile-enter flex w-full items-start pb-10">
      <ContextSidebar />
      <div className="min-w-0 flex-1">
        <TrashPreviewPanel id={id} mode={mode} />
      </div>
    </div>
  );
}

export default function TrashViewerPage() {
  return (
    <Suspense fallback={null}>
      <TrashViewerRoute />
    </Suspense>
  );
}
