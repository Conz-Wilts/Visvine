'use client';

// Standalone note view: /directory/note/<path segments> renders any non-entity
// brain note (folder indexes, sectors, deals…). The static `note` segment wins
// over the sibling /directory/[nodeId] route, so entity profiles are
// unaffected. Entity notes still open as profile Context tabs — links route
// there via resolveEntityNode; this page is everything else.
//
// Thin on purpose: the tab bar, docked tree and NoteContextPanel live in the
// persistent pane shell (directory/layout.tsx). This page owns only the note
// path from the URL and the Context⇄Raw mode, and registers those with the
// shell, so note→note re-points the same panel instead of remounting one.

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { type NoteMode } from '@/features/notes/components/NoteModeToggle';
import { usePaneChrome, type PaneTabItem } from '@/lib/contexts/PaneShellContext';

// A non-entity note is still a Context note — same "Context / Raw" top nav an
// entity profile's Context tab gets. The tabs ARE the editor mode.
const NOTE_TABS: PaneTabItem[] = [
  { id: 'context', label: 'Context' },
  { id: 'raw', label: 'Raw' },
];

function NoteViewerRoute() {
  const params = useParams();
  const raw = params.path;
  const segments = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const notePath = segments.map((s) => decodeURIComponent(String(s))).join('/');
  const [mode, setMode] = useState<NoteMode>('wysiwyg');

  // Switching notes resets to the Context (wysiwyg) tab — the profile Context
  // tab does the same across entities.
  useEffect(() => {
    setMode('wysiwyg');
  }, [notePath]);

  const activeTab = mode === 'raw' ? 'raw' : 'context';
  const handleSelect = useCallback((id: string) => {
    setMode(id === 'raw' ? 'raw' : 'wysiwyg');
  }, []);

  usePaneChrome({
    tabs: NOTE_TABS,
    activeId: activeTab,
    onSelect: handleSelect,
    // Only the wysiwyg editor portals a toolbar into the bar's attached region —
    // Raw is a plain textarea with nothing to put there.
    attachedOpen: activeTab === 'context',
    ariaLabel: 'Note sections',
    surface: { kind: 'note', path: notePath, mode },
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
