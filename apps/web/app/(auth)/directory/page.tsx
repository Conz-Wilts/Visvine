'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import ChatInterface from '@/components/chat/ChatInterface';
import NodeGrid from '@/components/dashboard/NodeGrid';
import DirectoryFilterBar from '@/components/dashboard/DirectoryFilterBar';
import DirectoryViewTabs, { type DirectoryView } from '@/components/dashboard/DirectoryViewTabs';
import { useDirectoryBrowse } from '@/hooks/useDirectoryBrowse';
import type { CommunityAlias } from '@/lib/types';

// The graph pulls in d3-force + the canvas renderer. Defer it so the Grid view
// never downloads it — it only loads when the Graph tab is opened.
const DirectoryGraphView = dynamic(() => import('@/components/dashboard/DirectoryGraphView'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-sm text-text-muted">Loading graph…</div>
  ),
});

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

  return (
    <div
      className={`relative w-full ${view === 'graph' ? 'flex flex-col' : ''}`}
      data-tour="directory-canvas"
      // Graph is a fixed canvas — pin the root to exactly <main>'s content box
      // (viewport − navbar 64px − main's pt-4/pb-6 = 40px), so the page never
      // scrolls vertically. The graph panel below fills the leftover space via
      // flex-1, so no per-element height math can drift out of sync. No
      // overflow-hidden here: the tab row bleeds up/left (negative margins, for
      // the flush look + navbar seam curve) and clipping it would shave "Grid".
      // The graph panel clips its own canvas; Grid/Tables keep the tall min-height.
      style={view === 'graph' ? { height: 'calc(100dvh - 64px - 40px)' } : { minHeight: 'calc(100dvh - 56px)' }}
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
          className="relative flex-1 min-h-0 w-full overflow-hidden"
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
            <DirectoryGraphView searchTerm={searchTerm} />
          </div>
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
