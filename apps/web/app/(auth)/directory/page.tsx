'use client';

import React from 'react';
import ChatInterface from '@/components/chat/ChatInterface';
import NodeGrid from '@/components/dashboard/NodeGrid';
import DirectoryFilterBar from '@/components/dashboard/DirectoryFilterBar';
import { useDirectoryBrowse } from '@/hooks/useDirectoryBrowse';
import type { CommunityAlias } from '@/lib/types';
import { PageTitle } from '@/components/ui';

/**
 * The Directory: a searchable, filterable card grid of everyone and everything
 * in the community. The graph lives on /context and the CRM table on /table.
 */
export default function DashboardPage() {
  const browse = useDirectoryBrowse();
  const {
    community, loading, error,
    searchTerm, setSearchTerm,
    filteredItems, handleItemClick,
  } = browse;

  return (
    <div
      className="relative w-full"
      data-tour="directory-canvas"
      style={{ minHeight: 'calc(100dvh - 56px)' }}
    >
      <PageTitle title="Directory" />

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
  );
}
