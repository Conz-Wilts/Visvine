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
import ProfileTabBar, { dockTopInsetFor, type ProfileTab, type TabConfig } from '@/components/profile/ProfileTabBar';
import ContentReveal from '@/components/ui/ContentReveal';
import { TabBarSlotProvider } from '@/lib/contexts/TabBarSlotContext';

// Tiptap + the notes stack load only here, same rationale as the profile page's
// deferred Context tab.
const NoteContextPanel = dynamic(
  () => import('@/features/notes/components/NoteContextPanel').then((m) => m.NoteContextPanel),
  { ssr: false, loading: () => null },
);
const ContextSidebar = dynamic(
  () => import('@/features/notes/components/ContextSidebar').then((m) => m.ContextSidebar),
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
// the context reads identically to opening a person/company note (both land under
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

  // Context ⇄ Raw drive the editor mode; the NoteContextPanel isn't given
  // onModeChange so its editor drops the inline Editor/Raw pill (the tabs own it).
  const activeTab: ProfileTab = mode === 'raw' ? 'raw' : 'context';

  // Only the wysiwyg editor portals a toolbar into the bar's attached region —
  // Raw is a plain textarea with nothing to put there, so the region stays shut
  // and the bar keeps its single-row height.
  const attachedOpen = activeTab === 'context';

  // Push the docked notes tree below the nav — same mechanism the Directory's
  // Grid/Context bar uses (setDockTopInset) — level with where the note begins,
  // which tracks whether the toolbar row is open.
  useEffect(() => {
    setDockTopInset(dockTopInsetFor(attachedOpen));
    return () => setDockTopInset(0);
  }, [setDockTopInset, attachedOpen]);

  // Switching notes resets to the Context (wysiwyg) tab — the profile Context tab
  // does the same across entities (its mode is derived from the URL ?tab param).
  useEffect(() => {
    setMode('wysiwyg');
  }, [notePath]);

  // The note body stays hidden until NoteContextPanel says its fetches are in, so
  // the entrance animates the note rather than the skeleton that preceded it.
  // Reset per note: clicking another note in the tree replays the same reveal.
  const [bodyReady, setBodyReady] = useState(false);
  const markBodyReady = useCallback(() => setBodyReady(true), []);
  useEffect(() => {
    setBodyReady(false);
  }, [notePath]);

  const handleTabChange = useCallback((tab: ProfileTab) => {
    setMode(tab === 'raw' ? 'raw' : 'wysiwyg');
  }, []);

  return (
    <TabBarSlotProvider>
      {/* No profile-enter on this container: it wraps the sticky tab bar, and the
          bar must NOT play an entrance. Arriving from the Directory's context, the
          Grid/Context bar sits at exactly this position and geometry — fading a
          replacement in from opacity 0 / 18px down is the flash. Only the note
          body below animates; the bar reads as the same bar, relabelled. */}
      <div className="w-full pb-10">
        {/* The tab bar spans the FULL pane width (no dock inset) and bleeds left
            over the docked notes tree with a raised z — so the Context/Raw bar
            reads as one continuous bar across the top, mirroring the Directory's
            Grid/Context tabs, rather than starting at the tree's right edge.
            Direct child of the tall page container so `sticky` has scroll range;
            "-top-4 -mt-4" cancels <main>'s pt-4 (see directory/[nodeId]/page.tsx). */}
        <ProfileTabBar
          nodeType="Note"
          tabs={NOTE_TABS}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          stickyTop="-top-4 -mt-4"
          edgeClass="-ml-[23px] z-[45]"
          attachedOpen={attachedOpen}
        />
        {/* Only the note content insets to clear the docked tree; the bar above
            stays full-bleed. */}
        <ContentReveal ready={bodyReady} style={dockInsetStyle}>
          <ContextSidebar currentPath={notePath} />
          <NoteContextPanel path={notePath} mode={mode} onReady={markBodyReady} />
        </ContentReveal>
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
