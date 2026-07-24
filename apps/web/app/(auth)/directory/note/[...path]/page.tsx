'use client';

// Standalone note view: /directory/note/<path segments> renders any non-entity
// brain note (folder indexes, sectors, deals…) with the embedded NoteEditor.
// The static `note` segment wins over the sibling /directory/[nodeId] route, so
// entity profiles are unaffected. Entity notes still open as profile Context
// tabs — links route there via resolveEntityNode; this page is everything else.

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';
import { useContextPanel } from '@/lib/contexts/ContextPanelContext';
import { CONTEXT_PANEL_W } from '@/features/shared/components/layout/Sidebar';
import { type NoteMode } from '@/features/notes/components/NoteModeToggle';
import ProfileTabBar, { type ProfileTab, type TabConfig } from '@/components/profile/ProfileTabBar';
import { TabBarSlotProvider } from '@/lib/contexts/TabBarSlotContext';

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

// A non-entity note is still a Context note — give it the same "Context / Raw"
// top nav an entity profile's Context tab gets, so opening a hub/index note from
// the graph reads identically to opening a person/company note (both land under
// a ProfileTabBar, not a bare toolbar with an inline Editor/Raw pill). The tabs
// ARE the editor mode here, exactly as on the profile page.
const NOTE_TABS: TabConfig[] = [
  { id: 'context', label: 'Context' },
  { id: 'raw', label: 'Raw' },
];

function NoteViewerRoute() {
  const params = useParams();
  const raw = params.path;
  const segments = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const notePath = segments.map((s) => decodeURIComponent(String(s))).join('/');
  const [mode, setMode] = useState<NoteMode>('wysiwyg');
  const dockInsetStyle = useDockInsetStyle();
  const { setDockTopInset } = useContextPanel();

  // Push the docked notes tree below the nav — same mechanism the Directory's
  // Grid/Graph/Tables bar uses (setDockTopInset). Our ProfileTabBar stacks two
  // h-12 (48px) bars: the Context/Raw tab row and its always-open attached
  // toolbar, so the tree starts 96px down, level with where the note begins.
  useEffect(() => {
    setDockTopInset(96);
    return () => setDockTopInset(0);
  }, [setDockTopInset]);

  // Switching notes resets to the Context (wysiwyg) tab — the profile Context tab
  // does the same across entities (its mode is derived from the URL ?tab param).
  useEffect(() => {
    setMode('wysiwyg');
  }, [notePath]);

  // Context ⇄ Raw drive the editor mode; the NoteContextPanel isn't given
  // onModeChange so its editor drops the inline Editor/Raw pill (the tabs own it).
  const activeTab: ProfileTab = mode === 'raw' ? 'raw' : 'context';
  const handleTabChange = useCallback((tab: ProfileTab) => {
    setMode(tab === 'raw' ? 'raw' : 'wysiwyg');
  }, []);

  return (
    <TabBarSlotProvider>
      <div className="profile-enter w-full pb-10">
        {/* The tab bar spans the FULL pane width (no dock inset) and bleeds left
            over the docked notes tree with a raised z — so the Context/Raw bar
            reads as one continuous bar across the top, mirroring the Directory's
            Grid/Graph/Tables tabs, rather than starting at the tree's right edge.
            Direct child of the tall page container so `sticky` has scroll range;
            "-top-4 -mt-4" cancels <main>'s pt-4 (see directory/[nodeId]/page.tsx). */}
        <ProfileTabBar
          nodeType="Note"
          tabs={NOTE_TABS}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          stickyTop="-top-4 -mt-4"
          edgeClass="-ml-[23px] z-[45]"
          attachedOpen
        />
        {/* Only the note content insets to clear the docked tree; the bar above
            stays full-bleed. */}
        <div style={dockInsetStyle}>
          <GraphContextSidebar currentPath={notePath} />
          <NoteContextPanel path={notePath} mode={mode} />
        </div>
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
