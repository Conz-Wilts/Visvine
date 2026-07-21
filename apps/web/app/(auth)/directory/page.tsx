'use client';

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import ChatInterface from '@/components/chat/ChatInterface';
import NodeGrid from '@/components/dashboard/NodeGrid';
import DirectoryFilterBar from '@/components/dashboard/DirectoryFilterBar';
import DirectoryViewTabs, { type DirectoryView } from '@/components/dashboard/DirectoryViewTabs';
import { useDirectoryBrowse } from '@/hooks/useDirectoryBrowse';
import { entityNotePath } from '@/lib/notes/entities';
import { useContextPanel } from '@/lib/contexts/ContextPanelContext';
import { CONTEXT_PANEL_W } from '@/features/shared/components/layout/Sidebar';
import type { CommunityAlias } from '@/lib/types';

// The graph pulls in d3-force + the canvas renderer. Defer it so the Grid view
// never downloads it — it only loads when the Graph tab is opened.
const DirectoryGraphView = dynamic(() => import('@/components/dashboard/DirectoryGraphView'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-sm text-text-muted">Loading graph…</div>
  ),
});

// The community context tree, docked into the global Sidebar (portal) on wide
// viewports — the same instance /context uses, so the Graph tab gets the notes
// sidebar too.
const GraphContextSidebar = dynamic(
  () => import('@/features/notes/components/GraphContextSidebar').then((m) => m.GraphContextSidebar),
  { ssr: false },
);

/**
 * The Directory: a Grid / Graph / Tables switcher over the community. Grid is
 * the searchable, filterable card grid; Graph is the community graph
 * (lazy-loaded); Tables is a stub for now. Views swap purely client-side — no
 * routing — so switching is instant and never re-runs the shell layout. The
 * dedicated /context route still hosts the graph full-bleed with its notes tree.
 */
export default function DashboardPage() {
  const [view, setView] = useState<DirectoryView>('grid');
  const browse = useDirectoryBrowse();
  const {
    community, loading, error,
    searchTerm, setSearchTerm,
    filteredItems, handleItemClick,
  } = browse;

  // The graph search's best-matching node, lifted out of the graph so the docked
  // notes tree can scroll to that entity's note alongside the graph focus.
  const [focusNode, setFocusNode] = useState<{ id: string; type: string } | null>(null);
  const focusPath = focusNode ? entityNotePath(focusNode) : null;

  // While the notes tree docks into the Sidebar the sidebar card widens by
  // CONTEXT_PANEL_W, but <main>'s left padding only clears the icon rail — the
  // graph must inset itself or the panel covers the search bar and graph edge.
  // dockRequested is already wide-gated (≥1024px) by GraphContextSidebar.
  const { dockRequested, contextOpen, setDockTopInset } = useContextPanel();
  const dockInset = dockRequested && contextOpen ? CONTEXT_PANEL_W : 0;

  // The Grid/Graph/Tables bar stays pinned at the top of the docked card (it's
  // raised above the Sidebar's z-index). Tell the dock to start its notes tree
  // below that 48px (h-12) bar so the panel no longer writes over it.
  useEffect(() => {
    setDockTopInset(48);
    return () => setDockTopInset(0);
  }, [setDockTopInset]);

  return (
    <div
      className="relative w-full"
      data-tour="directory-canvas"
      style={{ minHeight: 'calc(100dvh - 56px)' }}
    >
      <DirectoryViewTabs active={view} onChange={setView} />

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
        <div id="directory-panel-grid" role="tabpanel">
          <DirectoryFilterBar browse={browse} />

          <div className="w-full px-6 pt-4 pb-8">
            <div className="flex flex-col gap-5">
              {error && (
                <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-300">
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

      {/* Graph: full-bleed canvas that fills the pane below the tab row, with the
          search floating over it (z-20) so the graph extends behind it — the same
          immersive layout as the /context page, not a boxed panel. */}
      {view === 'graph' && (
        <div
          id="directory-panel-graph"
          role="tabpanel"
          className="relative w-full overflow-hidden"
          style={{
            height: 'calc(100dvh - 56px - 3rem)',
            marginLeft: dockInset || undefined,
            transition: 'margin-left 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)',
          }}
        >
          {/* left-1/2 centers within the graph panel, but the panel is pushed
              right by dockInset when the context dock opens — which drifts its
              midpoint (and this bar) right by dockInset/2. Cancel that so the
              search stays visually centered whether the dock is open or closed. */}
          <div
            className="absolute top-4 left-1/2 z-20 w-full max-w-2xl px-6"
            style={{ transform: `translateX(calc(-50% - ${dockInset / 2}px))`, transition: 'transform 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)' }}
          >
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
            <DirectoryGraphView searchTerm={searchTerm} onFocusNodeChange={setFocusNode} />
          </div>

          {/* Marks the notes tree dockable + portals it into the Sidebar host. */}
          <GraphContextSidebar currentPath={null} focusPath={focusPath} />
        </div>
      )}

      {view === 'tables' && (
        <div
          id="directory-panel-tables"
          role="tabpanel"
          className="flex w-full items-center justify-center px-6 py-24 text-sm text-text-muted"
        >
          Tables — coming soon
        </div>
      )}
    </div>
  );
}
