'use client';

import React, { useState, useMemo } from 'react';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import SpaceAvatar from '@/features/spaces/components/SpaceAvatar';
import { Space, aliasesForType } from '@/lib/types';
import { PageTitle } from '@/components/ui';

function formatMemberCount(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toString();
}

function SpaceCard({
  space,
  joined,
  onJoin,
  variant = 'default',
}: {
  space: Space;
  joined: boolean;
  onJoin: (c: Space) => void;
  variant?: 'default' | 'featured';
}) {
  const isFeatured = variant === 'featured';

  // Mirror the Directory NodeCard shape: vertical card with a fixed-height image
  // banner on top, centered content, and actions pinned to the bottom. Colored
  // border + soft glow exposed via CSS vars so hover is pure CSS.
  const accent = 'var(--color-brand-green)';
  const cardStyle = {
    borderColor: accent,
    '--card-glow': 'color-mix(in srgb, var(--color-brand-green) 33%, transparent)',
    '--card-glow-strong': 'color-mix(in srgb, var(--color-brand-green) 60%, transparent)',
  } as React.CSSProperties;

  return (
    <div
      className="bg-surface-1 rounded-2xl overflow-hidden cursor-pointer group flex flex-col h-[360px] w-full border-4 transition-[box-shadow,transform] duration-200 active:scale-[0.98] [box-shadow:0_6px_16px_rgba(0,0,0,0.08),0_0_12px_2px_var(--card-glow)] hover:[box-shadow:0_10px_24px_rgba(0,0,0,0.12),0_0_20px_4px_var(--card-glow-strong)]"
      style={cardStyle}
    >
      {/* Fixed-height image banner */}
      <div className="relative h-[180px] shrink-0 overflow-hidden">
        <SpaceAvatar
          name={space.name}
          imageUrl={space.imageUrl}
          className="w-full h-full !rounded-none group-hover:scale-105 transition-transform duration-300"
        />
        {isFeatured && (
          <div className="absolute top-3 right-3">
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700 shadow-sm">
              ⭐ Featured
            </span>
          </div>
        )}
      </div>

      {/* Content area — fills remaining height */}
      <div className="px-4 pt-3 pb-3 flex flex-col flex-1 min-h-0 items-center text-center">
        {/* Name — single line */}
        <h3 className="shrink-0 font-semibold text-text-primary text-sm leading-tight line-clamp-1 w-full mb-1">
          {space.name}
        </h3>

        {/* Member count */}
        <span className="shrink-0 text-xs text-text-muted flex items-center gap-1 mb-1.5">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
          {formatMemberCount(space.memberCount)} members
        </span>

        {/* Description — single line */}
        <p className="shrink-0 text-text-muted text-xs leading-snug line-clamp-1 w-full mb-1.5">
          {space.description || 'An emerging space waiting to be discovered.'}
        </p>

        {/* Location */}
        {space.location && (
          <div className="shrink-0 flex items-center justify-center gap-1 text-xs text-text-muted mb-1.5">
            <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="line-clamp-1">{space.location}</span>
          </div>
        )}

        {/* Join button pinned to bottom */}
        <div className="mt-auto pt-3 border-t border-border-subtle w-full" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => onJoin(space)}
            disabled={joined}
            className={`w-full flex items-center justify-center gap-1 rounded-full text-xs font-semibold py-2 transition-all ${
              joined
                ? 'bg-brand-light-bg text-brand-green cursor-default'
                : 'bg-brand-green text-white hover:opacity-90 shadow-sm active:scale-[0.98]'
            }`}
          >
            {joined ? (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Joined
              </>
            ) : (
              'Join'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DiscoverPage() {
  const { spaces, joinSpace, joinedSpaces } = useSpace();
  const [pendingSpace, setPendingSpace] = useState<Space | null>(null);
  const [selectedAlias, setSelectedAlias] = useState('');
  const [joining, setJoining] = useState(false);
  const [search, setSearch] = useState('');

  const isJoined = (id: string) => joinedSpaces.some(c => c.id === id);

  const handleJoin = (space: Space) => {
    // Only Person-scoped aliases are selectable when joining (a user is a person),
    // so skip the picker entirely when none exist.
    const aliases = aliasesForType(space.aliases, 'Person');
    if (aliases.length > 0) {
      setPendingSpace(space);
      setSelectedAlias('');
    } else {
      doJoin(space.id, undefined);
    }
  };

  const doJoin = async (spaceId: string, alias: string | undefined) => {
    setJoining(true);
    try {
      await joinSpace(spaceId, alias);
    } finally {
      setJoining(false);
      setPendingSpace(null);
      setSelectedAlias('');
    }
  };

  const filteredSpaces = useMemo(() => {
    let result = spaces;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(c =>
        c.name.toLowerCase().includes(q) ||
        (c.description ?? '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [spaces, search]);

  // A user joins as a person, so only offer Person-scoped aliases (e.g. "Founder").
  // Org-scoped aliases like "Portfolio Company" must never be selectable here.
  const aliases = aliasesForType(pendingSpace?.aliases, 'Person');

  return (
    <div className="w-full min-h-screen bg-gradient-to-b from-surface-1 to-surface-2">
      <div className="w-full px-4 sm:px-6 lg:px-8 pb-10">

        {/* Page header — centered title, consistent with other pages */}
        <PageTitle title="Discover Spaces" />

        {/* Search bar — centered, sized to match Directory/Events/Resources */}
        <div className="flex justify-center pt-6">
          <div className="w-full max-w-2xl">
            <div className="flex min-h-[56px] items-center gap-2.5 rounded-2xl border border-border-default bg-surface-1 px-4 shadow-sm">
              <svg className="h-4 w-4 shrink-0 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search spaces by name, description, or tags…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="flex-1 bg-transparent text-base text-text-primary placeholder:text-text-muted focus:outline-none"
              />
            </div>
          </div>
        </div>

        {filteredSpaces.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-20 h-20 rounded-full bg-surface-2 flex items-center justify-center mb-4">
              <span className="text-4xl">🔍</span>
            </div>
            <p className="text-lg font-medium text-text-primary mb-1">No spaces found</p>
            <p className="text-sm text-text-muted">Try a different search.</p>
          </div>
        ) : (
          <div className="grid gap-6 pt-6" style={{ gridTemplateColumns: 'repeat(auto-fill, 260px)', justifyContent: 'space-evenly' }}>
            {filteredSpaces.map((space) => (
              <SpaceCard
                key={space.id}
                space={space}
                joined={isJoined(space.id)}
                onJoin={handleJoin}
              />
            ))}
          </div>
        )}
      </div>

      {/* Alias selection modal */}
      {pendingSpace && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => { setPendingSpace(null); setSelectedAlias(''); }}
        >
          <div
            className="bg-surface-1 rounded-2xl shadow-2xl border border-border-subtle p-8 w-full max-w-md mx-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <SpaceAvatar name={pendingSpace.name} imageUrl={pendingSpace.imageUrl} size="md" />
              <div>
                <h2 className="text-lg font-semibold text-text-primary">How do you identify?</h2>
                <p className="text-xs text-text-muted">{pendingSpace.name}</p>
              </div>
            </div>
            <p className="text-sm text-text-secondary mb-6">
              Choose your role so others in the space know who you are.
            </p>

            <div className="grid grid-cols-2 gap-3 mb-6">
              {aliases.map((alias) => (
                <button
                  key={alias.name}
                  onClick={() => setSelectedAlias(alias.name)}
                  className={`flex items-center gap-2 px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all duration-150 ${
                    selectedAlias === alias.name
                      ? 'border-brand-green bg-brand-light-bg text-brand-green'
                      : 'border-border-subtle bg-surface-2 text-text-primary hover:border-border-default'
                  }`}
                  style={selectedAlias === alias.name
                    ? { borderColor: alias.color, color: alias.color, backgroundColor: alias.color + '18' }
                    : {}}
                >
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: alias.color }} />
                  {alias.name}
                </button>
              ))}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setPendingSpace(null); setSelectedAlias(''); }}
                className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-full border border-border-default text-text-secondary hover:bg-surface-2 transition-all duration-200"
              >
                Cancel
              </button>
              <button
                onClick={() => doJoin(pendingSpace.id, selectedAlias || undefined)}
                disabled={joining}
                className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-full bg-brand-green text-white hover:opacity-90 shadow-sm transition-all duration-200 disabled:opacity-60"
              >
                {joining ? 'Joining…' : 'Join'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
