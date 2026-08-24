'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import SpaceAvatar from '@/features/spaces/components/SpaceAvatar';
import { Button, EmptyState } from '@/components/ui';

export default function SpacesPage() {
  const { joinedSpaces: allJoined, currentSpace, setCurrentSpace, leaveSpace } = useSpace();
  // Root spaces only: the ones inside them are reached through the switcher
  // (docs/sub-spaces.md), and a member of a big space would otherwise see
  // every one of its records listed as a space of their own.
  const joinedSpaces = allJoined.filter(s => !s.parentId);
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
    <div className="w-full">
      <div className="max-w-3xl px-4 sm:px-6 pb-10">

        {/* One line of chrome: the count on the left, Discover on the right */}
        <div className="flex items-center justify-between gap-4 pt-2 pb-2">
          <p className="text-sm text-text-muted">
            {joinedSpaces.length} {joinedSpaces.length === 1 ? 'space' : 'spaces'}
          </p>
          <Link href="/discover" className="text-sm font-semibold text-brand-dark-green hover:underline">
            Discover spaces
          </Link>
        </div>

        {/* Spaces — one row each: avatar, name + facts, the one action */}
        {joinedSpaces.length === 0 ? (
          <EmptyState
            title="No spaces yet"
            description="You haven't joined any spaces yet. Discover and join spaces to get started."
            action={{ label: 'Discover spaces', href: '/discover' }}
          />
        ) : (
          <ul className="divide-y divide-border-subtle">
            {joinedSpaces.map((space) => {
              const isActive = currentSpace?.id === space.id;
              const facts = [
                `${space.memberCount} ${space.memberCount === 1 ? 'member' : 'members'}`,
                space.location,
              ].filter(Boolean).join(' · ');

              return (
                <li key={space.id} className="flex items-center gap-4 py-4">
                  <Link href={`/communities/${encodeURIComponent(space.id)}`} className="h-14 w-14 shrink-0 overflow-hidden rounded-lg">
                    <SpaceAvatar name={space.name} imageUrl={space.imageUrl} className="h-full w-full" />
                  </Link>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <Link
                        href={`/communities/${encodeURIComponent(space.id)}`}
                        className="truncate text-[15px] font-semibold text-text-primary hover:underline"
                      >
                        {space.name}
                      </Link>
                      {isActive && <span className="shrink-0 text-xs font-semibold text-brand-dark-green">Current</span>}
                    </div>
                    <p className="truncate text-[13px] text-text-muted">{facts}</p>
                    {space.description && <p className="mt-0.5 truncate text-[13px] text-text-secondary">{space.description}</p>}
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    {!isActive && (
                      <Button variant="ghost" size="sm" onClick={() => setCurrentSpace(space.id)}>
                        Switch
                      </Button>
                    )}
                    {confirmLeave === space.id ? (
                      <span className="flex items-center gap-2 text-xs">
                        <button onClick={() => setConfirmLeave(null)} className="font-medium text-text-muted hover:text-text-secondary">
                          Cancel
                        </button>
                        <button
                          onClick={() => handleLeave(space.id)}
                          disabled={leaving === space.id}
                          className="font-medium text-red-500 hover:text-red-600 disabled:opacity-60"
                        >
                          {leaving === space.id ? 'Leaving…' : 'Leave'}
                        </button>
                      </span>
                    ) : (
                      <button onClick={() => setConfirmLeave(space.id)} className="text-xs text-text-muted hover:text-red-500">
                        Leave
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
