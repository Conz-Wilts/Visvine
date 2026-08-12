'use client';

import React, { Suspense, useCallback, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import NodeGrid from '@/features/directory/components/NodeGrid';
import DirectoryToolbar from '@/features/directory/components/DirectoryToolbar';
import { EmptyState } from '@/components/ui';
import { usePaneChrome, type PaneTabItem } from '@/features/shared/contexts/PaneShellContext';
import { useDirectoryBrowse } from '@/features/directory/hooks/useDirectoryBrowse';
import { useContextPanel } from '@/features/shared/contexts/ContextPanelContext';
import { useCommunity } from '@/features/shared/contexts/CommunityContext';
import { cachedFetch, contextKeys, invalidateContextCache, prefetchNoteContext } from '@/features/notes/lib/contextPrefetch';
import { notesApi } from '@/features/notes/lib/notesApi';
import { noteHref } from '@/lib/notes/entities';
import { newIndexContent } from '@/lib/notes/shared/indexNote';
import type { CommunityAlias } from '@/lib/types';

const DIRECTORY_TABS: PaneTabItem[] = [
  { id: 'grid', label: 'Grid' },
  { id: 'context', label: 'Context' },
];

/**
 * The Directory: a searchable, filterable card grid of everyone and everything.
 * The Context tab in the pane bar isn't a view of this page — it navigates to
 * the brain's top-level index note (`index.md`, the community's home page).
 * The bar itself lives in the persistent pane shell (directory/layout.tsx) —
 * this page just registers its tabs.
 */
export default function DashboardPage() {
  // useSearchParams needs a Suspense boundary above it.
  return (
    <Suspense fallback={null}>
      <DirectoryPane />
    </Suspense>
  );
}

function DirectoryPane() {
  const router = useRouter();
  const { currentCommunity, loading: communityLoading } = useCommunity();
  const noSpace = !communityLoading && !currentCommunity;
  const communityId = currentCommunity?.id ?? null;
  const communityName = currentCommunity?.name ?? '';
  const { releaseDockNow } = useContextPanel();

  // Context navigates to the brain's root index note. New brains are seeded
  // with one at create time; an older brain that never got one has it written
  // here on first open — the note page's missing state is an access-request
  // card, which is the wrong surface for "this note was never written".
  const openContext = useCallback(() => {
    if (!communityId) return;
    prefetchNoteContext(communityId, 'index.md');
    cachedFetch(contextKeys.list(communityId), () => notesApi.list(communityId))
      .then(async ({ notes }) => {
        if (!notes.some((n) => n.path === 'index.md')) {
          try {
            await notesApi.create(communityId, 'index.md', newIndexContent({ title: communityName || 'Home' }));
            invalidateContextCache(
              contextKeys.read(communityId, 'index.md'),
              contextKeys.list(communityId),
              contextKeys.tree(communityId),
            );
          } catch (err) {
            // "already exists" = someone else seeded it between list and create.
            if (!(err instanceof Error && /already exists/i.test(err.message))) throw err;
          }
        }
        router.push(noteHref('index.md'));
      })
      .catch(() => router.push(noteHref('index.md')));
  }, [communityId, communityName, router]);

  // ?view=context used to open the standalone knowledge browser here; that
  // surface is gone, so old links land on the grid and hop to the index note.
  const wantsContext = useSearchParams().get('view') === 'context';
  const redirected = useRef(false);
  useEffect(() => {
    if (!wantsContext || redirected.current || !communityId) return;
    redirected.current = true;
    openContext();
  }, [wantsContext, communityId, openContext]);

  // Selecting Grid closes any docked tree now, skipping the release grace:
  // the grace exists for navigations where another surface re-claims the dock,
  // but Grid is a terminal state — waiting just holds the closing panel over
  // cards that are already animating in. The dock is NOT released for Context —
  // the note page re-claims it, and the release grace bridges the swap.
  const handleSelect = useCallback(
    (id: string) => {
      if (id === 'grid') {
        releaseDockNow();
        return;
      }
      openContext();
    },
    [releaseDockNow, openContext],
  );
  usePaneChrome({
    tabs: noSpace ? null : DIRECTORY_TABS,
    activeId: 'grid',
    onSelect: handleSelect,
    attachedOpen: false,
    ariaLabel: 'Directory views',
    surface: null,
  });

  const browse = useDirectoryBrowse();
  const { community, loading, error, filteredItems, handleItemClick } = browse;

  // No space selected (zero memberships): the sidebar rail is already empty,
  // so the directory chrome — tab bar, toolbar, grid — hides too, leaving only
  // the shell navbar and a pointer to Discover.
  if (noSpace) {
    return (
      <div className="relative w-full flex items-center justify-center" style={{ minHeight: 'calc(100dvh - 56px)' }}>
        <EmptyState
          title="No spaces yet"
          description="You haven't joined any spaces yet. Discover and join spaces to get started."
          action={{ label: 'Discover Spaces', href: '/discover' }}
        />
      </div>
    );
  }

  return (
    <div className="relative w-full" style={{ minHeight: 'calc(100dvh - 56px)' }}>
      {/* Search, filters, sort and count ride one sticky toolbar welded under
          the pane tab bar; the cards scroll beneath it. */}
      <div id="panel-grid" role="tabpanel">
        <DirectoryToolbar browse={browse} />

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
    </div>
  );
}
