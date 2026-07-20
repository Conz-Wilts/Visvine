'use client';

// Standalone note view: /directory/note/<path segments> renders any non-entity
// brain note (folder indexes, sectors, deals…) with the embedded NoteEditor.
// The static `note` segment wins over the sibling /directory/[nodeId] route, so
// entity profiles are unaffected. Entity notes still open as profile Context
// tabs — links route there via resolveEntityNode; this page is everything else.

import React, { Suspense, useState } from 'react';
import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';
import { useContextPanel } from '@/lib/contexts/ContextPanelContext';
import { CONTEXT_PANEL_W } from '@/features/shared/components/layout/Sidebar';
import { type NoteMode } from '@/features/notes/components/NoteModeToggle';
import { TabBarSlotProvider, useTabBarSlot } from '@/lib/contexts/TabBarSlotContext';

// Tiptap + the notes stack load only here, same rationale as the profile page's
// deferred Context tab.
const NoteContextPanel = dynamic(
  () => import('@/features/notes/components/NoteContextPanel').then((m) => m.NoteContextPanel),
  { ssr: false, loading: () => null },
);
const GraphContextSidebar = dynamic(
  () => import('@/features/notes/components/GraphContextSidebar').then((m) => m.GraphContextSidebar),
  { ssr: false, loading: () => null },
);

// Same contract as the profile page: while the notes tree is docked into the
// global Sidebar AND open, the page insets itself to clear the panel column.
function useDockInsetStyle(): React.CSSProperties {
  const { dockRequested, contextOpen } = useContextPanel();
  return {
    paddingLeft: dockRequested && contextOpen ? CONTEXT_PANEL_W : undefined,
    transition: 'padding-left 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)',
  };
}

// A minimal stand-in for ProfileTabBar's sticky box: no tabs, just the attached
// region the embedded NoteEditor portals its toolbar into (sidebar toggle, star,
// format controls, Editor/Raw). Same sticky offsets as ProfileTabBar ("-top-4
// -mt-4": <main> has pt-4 and sticky resolves below that padding — see the
// comment in directory/[nodeId]/page.tsx).
function NoteToolbarBar() {
  const { setHost } = useTabBarSlot();
  return (
    <div className="sticky -top-4 z-20 -ml-6 -mt-4 border-b border-border-subtle bg-surface-1">
      <div ref={setHost} className="min-h-12 w-full" />
    </div>
  );
}

function NoteViewerRoute() {
  const params = useParams();
  const raw = params.path;
  const segments = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const notePath = segments.map((s) => decodeURIComponent(String(s))).join('/');
  const [mode, setMode] = useState<NoteMode>('wysiwyg');
  const dockInsetStyle = useDockInsetStyle();

  return (
    <TabBarSlotProvider>
      <div className="profile-enter w-full pb-10" style={dockInsetStyle}>
        {/* Direct child of the tall page container so `sticky` has scroll range. */}
        <NoteToolbarBar />
        <GraphContextSidebar currentPath={notePath} />
        <NoteContextPanel path={notePath} mode={mode} onModeChange={setMode} />
      </div>
    </TabBarSlotProvider>
  );
}

export default function NoteViewerPage() {
  return (
    <Suspense fallback={null}>
      <NoteViewerRoute />
    </Suspense>
  );
}
