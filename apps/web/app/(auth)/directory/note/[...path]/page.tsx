'use client';

// Standalone note view: /directory/note/<path segments> renders any non-entity
// context note (folder indexes, sectors, deals…). The static `note` segment wins
// over the sibling /directory/[nodeId] route, so entity profiles are
// unaffected. Entity notes still open as profile Context tabs — links route
// there via resolveEntityOwner, and a hand-typed (or stale) entity/sub-note URL
// landing here is redirected the same way; this page is everything else.
//
// Thin on purpose: the tab bar, docked tree and NoteContextPanel live in the
// persistent pane shell (directory/layout.tsx). This page owns only the note
// path from the URL and the Context⇄Raw mode, and registers those with the
// shell, so note→note re-points the same panel instead of remounting one.

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { type NoteMode } from '@/features/notes/components/NoteModeToggle';
import { usePaneChrome, type PaneTabItem } from '@/features/shared/contexts/PaneShellContext';
import { useContextPanel } from '@/features/shared/contexts/ContextPanelContext';
import { useDirectoryEntities } from '@/features/notes/lib/useDirectoryEntities';
import { useSpaceContextData } from '@/features/notes/hooks/useSpaceContextData';
import {
  entityContextHref,
  entityOwnerPathOf,
  parseEntityHref,
  resolveEntityOwner,
} from '@/lib/notes/entities';
import { INDEX_BASENAME } from '@/lib/notes/shared/indexNote';

// A non-entity note is still a Context note — same "Context / Raw" top nav an
// entity profile's Context tab gets. The tabs ARE the editor mode.
const NOTE_TABS: PaneTabItem[] = [
  { id: 'context', label: 'Context' },
  { id: 'raw', label: 'Raw' },
];

// The context-root index is where the Directory's Context tab lands, so it keeps
// the Directory's own Grid tab in the bar — Context still reads as a sibling
// view of the grid rather than a place you left it for. Any other note drops
// Grid and shows the plain note bar above.
const ROOT_INDEX_TABS: PaneTabItem[] = [{ id: 'grid', label: 'Grid' }, ...NOTE_TABS];

function NoteViewerRoute() {
  const params = useParams();
  const router = useRouter();
  const { releaseDockNow } = useContextPanel();
  const raw = params.path;
  const segments = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const notePath = segments.map((s) => decodeURIComponent(String(s))).join('/');
  const isRootIndex = notePath === INDEX_BASENAME;
  const [mode, setMode] = useState<NoteMode>('wysiwyg');

  // An entity note (either form) or a sub-note in an entity folder belongs
  // under the entity's chrome: send it to the profile Context tab. Until the
  // directory has loaded we can't tell whose it is, so an entity-shaped path
  // holds the tree-only chrome rather than flashing the plain note bar first.
  const { entityByPath } = useDirectoryEntities();
  const { loading: entitiesLoading } = useSpaceContextData();
  const owner = resolveEntityOwner(notePath, entityByPath);
  const ownerId = owner?.id ?? null;
  const ownerSub = owner?.subPath ?? null;
  const entityShaped = parseEntityHref(notePath) !== null || entityOwnerPathOf(notePath) !== null;
  const redirecting = ownerId !== null || (entityShaped && entitiesLoading);
  useEffect(() => {
    if (ownerId) router.replace(entityContextHref(ownerId, ownerSub));
  }, [ownerId, ownerSub, router]);

  // Switching notes resets to the Context (wysiwyg) tab — the profile Context
  // tab does the same across entities.
  useEffect(() => {
    setMode('wysiwyg');
  }, [notePath]);

  const activeTab = mode === 'raw' ? 'raw' : 'context';
  const handleSelect = useCallback(
    (id: string) => {
      if (id === 'grid') {
        // Same immediate dock release the Directory's own Grid tab does: Grid
        // is a terminal state for the docked tree, so the grace would only hold
        // the closing panel over cards already animating in.
        releaseDockNow();
        router.push('/directory');
        return;
      }
      setMode(id === 'raw' ? 'raw' : 'wysiwyg');
    },
    [releaseDockNow, router],
  );

  usePaneChrome({
    tabs: redirecting ? null : isRootIndex ? ROOT_INDEX_TABS : NOTE_TABS,
    activeId: redirecting ? null : activeTab,
    onSelect: handleSelect,
    // Only the wysiwyg editor portals a toolbar into the bar's attached region —
    // Raw is a plain textarea with nothing to put there.
    attachedOpen: !redirecting && activeTab === 'context',
    ariaLabel: 'Note sections',
    surface: redirecting ? { kind: 'tree-only', notePath } : { kind: 'note', path: notePath, mode },
  });

  // Body is entirely shell-rendered (PaneSurfaceHost).
  return null;
}

export default function NoteViewerPage() {
  return (
    <Suspense fallback={null}>
      <NoteViewerRoute />
    </Suspense>
  );
}
