'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import SpaceAvatar from '@/features/spaces/components/SpaceAvatar';
import { EmptyState, PageTitle } from '@/components/ui';

export default function SpacesPage() {
  const { joinedSpaces, currentSpace, setCurrentSpace, leaveSpace } = useSpace();
  const [leaving, setLeaving] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState<string | null>(null);

  async function handleLeave(spaceId: string) {
    setLeaving(spaceId);
    try {
      await leaveSpace(spaceId);
    } finally {
      setLeaving(null);
      setConfirmLeave(null);
    }
  }

  return (
    <div className="w-full min-h-screen bg-gradient-to-b from-surface-1 to-surface-2">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 pb-10">

        {/* Page header — centered title, consistent with other pages */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 mb-10">
          <div />
          <PageTitle title="My Spaces" />
          <Link
            href="/discover"
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg bg-brand-green hover:bg-brand-green/90 active:scale-[0.98] shadow-sm transition-all duration-200 shrink-0 justify-self-end"
            style={{ color: '#ffffff' }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
            Discover Spaces
          </Link>
        </div>

        {/* Spaces */}
        {joinedSpaces.length === 0 ? (
          <EmptyState
            title="No spaces yet"
            description="You haven't joined any spaces yet. Discover and join spaces to get started."
            action={{ label: 'Discover Spaces', href: '/discover' }}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {joinedSpaces.map((space) => {
              const isActive = currentSpace?.id === space.id;

              return (
                <div
                  key={space.id}
                  className={`group relative bg-surface-1 rounded-2xl hover:shadow-xl transition-all duration-300 flex items-center p-4 shadow-sm border-2 border-brand-green ${
                    isActive ? 'ring-2 ring-brand-green/20' : ''
                  }`}
                >
                  {/* Avatar */}
                  <Link
                    href={`/communities/${encodeURIComponent(space.id)}`}
                    className="relative shrink-0 w-16 h-16 rounded-xl ring-3 ring-surface-2 group-hover:ring-brand-green/20 transition-all duration-300"
                  >
                    <SpaceAvatar
                      name={space.name}
                      imageUrl={space.imageUrl}
                      className="w-full h-full"
                    />
                  </Link>

                  {/* Content */}
                  <div className="flex-1 flex flex-col ml-4 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Link
                        href={`/communities/${encodeURIComponent(space.id)}`}
                        className="text-base font-semibold text-text-primary leading-tight truncate hover:underline"
                      >
                        {space.name}
                      </Link>
                      {isActive && (
                        <span className="px-2 py-0.5 text-xs font-semibold rounded-md bg-brand-green text-white">
                          Active
                        </span>
                      )}
                      <span className="text-xs text-text-muted flex items-center gap-1 shrink-0">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                        </svg>
                        {space.memberCount}
                      </span>
                    </div>

                    <p className="text-xs text-text-muted line-clamp-1 mb-2">
                      {space.description}
                    </p>

                    {space.location && (
                      <div className="flex items-center gap-1 text-xs text-text-muted mb-2">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        {space.location}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="ml-4 shrink-0 flex flex-col items-end gap-2">
                    {!isActive && (
                      <button
                        onClick={() => setCurrentSpace(space.id)}
                        className="px-4 py-2 text-sm font-semibold rounded-lg border border-border-default text-text-secondary hover:bg-surface-2 transition-all duration-200"
                      >
                        Switch
                      </button>
                    )}
                    <Link
                      href="/directory"
                      className="px-4 py-2 text-sm font-semibold rounded-lg bg-brand-green hover:bg-brand-green/90 active:scale-[0.98] transition-all duration-200"
                      style={{ color: '#ffffff' }}
                    >
                      View Network
                    </Link>

                    {confirmLeave === space.id ? (
                      <div className="flex items-center gap-2 mt-1">
                        <button
                          onClick={() => setConfirmLeave(null)}
                          className="text-xs font-medium text-text-muted hover:text-text-secondary transition"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleLeave(space.id)}
                          disabled={leaving === space.id}
                          className="text-xs font-medium text-red-500 hover:text-red-600 transition disabled:opacity-60"
                        >
                          {leaving === space.id ? 'Leaving…' : 'Confirm'}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmLeave(space.id)}
                        className="text-xs text-text-muted hover:text-red-500 transition mt-1"
                      >
                        Leave
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
