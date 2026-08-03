'use client';

import React, { useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import ChatInterface from '@/components/chat/ChatInterface';
import NodeGrid from '@/components/dashboard/NodeGrid';
import DirectoryFilterBar from '@/components/dashboard/DirectoryFilterBar';
import { usePaneChrome, type PaneTabItem } from '@/lib/contexts/PaneShellContext';
import { useDirectoryBrowse } from '@/hooks/useDirectoryBrowse';
import { useContextPanel } from '@/lib/contexts/ContextPanelContext';
import { CONTEXT_PANEL_W } from '@/features/shared/components/layout/Sidebar';
import { entityNotePath } from '@/lib/notes/entities';
import type { CommunityAlias } from '@/lib/types';

// The context pulls in d3-force + the canvas renderer. Defer it so the Grid view
// never downloads it — it only loads when the Context tab is opened.
const DirectoryContextView = dynamic(() => import('@/components/dashboard/DirectoryContextView'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-sm text-text-muted">Loading context…</div>
  ),
});

// The community context tree, docked into the global Sidebar (portal) on wide
// viewports — the same instance the /context page and profile Context tab use.
const ContextSidebar = dynamic(
  () => import('@/features/notes/components/ContextSidebar').then((m) => m.ContextSidebar),
  { ssr: false, loading: () => null },
);

type DirectoryView = 'grid' | 'context';

const DIRECTORY_TABS: PaneTabItem[] = [
  { id: 'grid', label: 'Grid' },
  { id: 'context', label: 'Context' },
];

/**
 * The Directory: a Grid / Context switcher over the community. Grid is the
 * searchable, filterable card grid; Context is the lazy-loaded community
 * context. Views swap purely client-side, so switching is instant and never
 * re-runs the shell layout. The bar itself lives in the persistent pane shell
 * (directory/layout.tsx) — this page just registers its tabs and view state.
 */
export default function DashboardPage() {
  const [view, setView] = useState<DirectoryView>('grid');
  const { dockRequested, contextOpen, releaseDockNow } = useContextPanel();
  // Switching to Grid closes the docked tree now, skipping the release grace:
  // the grace exists for navigations where another surface re-claims the dock,
  // but Grid is a terminal state — waiting just holds the closing panel over
  // cards that are already animating in.
  const handleSelect = useCallback(
    (id: string) => {
      if (id === 'grid') releaseDockNow();
      setView(id as DirectoryView);
    },
    [releaseDockNow],
  );
  usePaneChrome({
    tabs: DIRECTORY_TABS,
    activeId: view,
    onSelect: handleSelect,
    attachedOpen: false,
    ariaLabel: 'Directory views',
    surface: null,
  });
  const browse = useDirectoryBrowse();
  // The context search's best-matching node, lifted out so the docked tree can
  // scroll to that entity's note alongside the canvas focus (same as /context).
  const [focusNode, setFocusNode] = useState<{ id: string; type: string } | null>(null);
  const focusPath = focusNode ? entityNotePath(focusNode) : null;
  // While the tree is docked AND open the sidebar card widens by CONTEXT_PANEL_W,
  // but <main>'s left padding only clears the icon rail — the canvas pane must
  // inset itself or the panel covers the search bar and the context's left edge.
  const dockInset = dockRequested && contextOpen ? CONTEXT_PANEL_W : 0;
  const {
    community, loading, error,
    searchTerm, setSearchTerm,
    filteredItems, handleItemClick,
  } = browse;

  return (
    <div
      className={`relative w-full ${view === 'context' ? 'flex flex-col' : ''}`}
      data-tour="directory-canvas"
      // Context is a fixed canvas — pin the root to the space left below the
      // shell's tab bar (viewport − navbar 64px − main's pt-4/pb-6 = 40px − the
      // bar's 32px of flow height: a 48px row minus its -mt-4 pull-up), so the
      // page never scrolls vertically. The panel below fills the rest via
      // flex-1 and clips its own canvas; Grid keeps the tall min-height.
      style={view === 'context' ? { height: 'calc(100dvh - 64px - 40px - 32px)' } : { minHeight: 'calc(100dvh - 56px)' }}
    >
      {/* Grid: search sits in normal flow above the filter bar and card grid. */}
      {view === 'grid' && (
        <div className="flex justify-center px-6 pt-6">
          <div className="flex w-full max-w-2xl">
            <div className="flex-1 flex items-center gap-3">
              <div className="flex-1">
                <ChatInterface
                  value={searchTerm}
                  onChange={setSearchTerm}
                  placeholder="Search…"
                  hideSubmitButton
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {view === 'grid' && (
        <div id="panel-grid" role="tabpanel">
          <DirectoryFilterBar browse={browse} />

          <div className="w-full px-6 pt-4 pb-8">
            <div className="flex flex-col gap-5">
              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <NodeGrid
                items={filteredItems}
                loading={loading}
                onCardClick={handleItemClick}
                nodeTypes={community?.nodeTypes}
                communityAliases={community?.communityAliases as CommunityAlias[] | undefined}
              />
            </div>
          </div>
        </div>
      )}

      {/* Context: full-bleed canvas that fills the pane below the tab row, with the
          search floating over it (z-20) so the context extends behind it — the same
          immersive layout as the /context page, not a boxed panel. */}
      {view === 'context' && (
        <div
          id="panel-context"
          role="tabpanel"
          className="relative flex-1 min-h-0 overflow-hidden"
          // marginLeft (not padding): the search + canvas are absolutely
          // positioned and resolve against the padding box, so padding would be
          // ignored. No w-full either — an explicit 100% width would keep the
          // pane full-width and the margin would push it off the right edge
          // (horizontal scrollbar + an off-centre search); auto width lets the
          // flex stretch shrink it by exactly the docked panel's width.
          style={{
            marginLeft: dockInset || undefined,
            transition: 'margin-left 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)',
          }}
        >
          <div className="absolute top-4 left-1/2 z-20 w-full max-w-2xl -translate-x-1/2 px-6">
            <div className="flex-1 flex items-center gap-3">
              <div className="flex-1">
                <ChatInterface
                  value={searchTerm}
                  onChange={setSearchTerm}
                  placeholder="Search…"
                  hideSubmitButton
                />
              </div>
            </div>
          </div>

          <div className="absolute inset-0 px-6">
            <DirectoryContextView searchTerm={searchTerm} onFocusNodeChange={setFocusNode} />
          </div>
        </div>
      )}

      {/* Marks the notes tree dockable + portals it into the Sidebar host —
          only while the Context view is open, so the Grid view keeps the plain rail. */}
      {view === 'context' && <ContextSidebar currentPath={null} focusPath={focusPath} />}

    </div>
  );
}
