'use client';

import React, { useState, useMemo } from 'react';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import CommunityAvatar from '@/components/community/CommunityAvatar';
import { Community, aliasesForType } from '@/lib/types';
import Badge from '@/components/ui/Badge';
import { PageTitle } from '@/components/ui';

const CATEGORY_FILTERS = ['All', 'Startup', 'VC', 'Technology', 'Innovation'] as const;

function formatMemberCount(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toString();
}

function CommunityCard({
  community,
  joined,
  onJoin,
  variant = 'default',
}: {
  community: Community;
  joined: boolean;
  onJoin: (c: Community) => void;
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
        <CommunityAvatar
          name={community.name}
          imageUrl={community.imageUrl}
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
          {community.name}
        </h3>

        {/* Member count */}
        <span className="shrink-0 text-xs text-text-muted flex items-center gap-1 mb-1.5">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
          {formatMemberCount(community.memberCount)} members
        </span>

        {/* Description — single line */}
        <p className="shrink-0 text-text-muted text-xs leading-snug line-clamp-1 w-full mb-1.5">
          {community.description || 'An emerging community waiting to be discovered.'}
        </p>

        {/* Location */}
        {community.location && (
          <div className="shrink-0 flex items-center justify-center gap-1 text-xs text-text-muted mb-1.5">
            <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="line-clamp-1">{community.location}</span>
          </div>
        )}

        {/* Tags */}
        {community.tags && community.tags.length > 0 && (
          <div className="shrink-0 flex flex-wrap justify-center gap-1.5">
            {community.tags.slice(0, 2).map((tag, index) => (
              <Badge key={index} variant="tag">
                {tag}
              </Badge>
            ))}
          </div>
        )}

        {/* Join button pinned to bottom */}
        <div className="mt-auto pt-3 border-t border-border-subtle w-full" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => onJoin(community)}
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
  const { communities, joinCommunity, joinedCommunities } = useCommunity();
  const [pendingCommunity, setPendingCommunity] = useState<Community | null>(null);
  const [selectedAlias, setSelectedAlias] = useState('');
  const [joining, setJoining] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [search, setSearch] = useState('');

  const isJoined = (id: string) => joinedCommunities.some(c => c.id === id);

  const handleJoin = (community: Community) => {
    // Only Person-scoped aliases are selectable when joining (a user is a person),
    // so skip the picker entirely when none exist.
    const aliases = aliasesForType(community.communityAliases, 'Person');
    if (aliases.length > 0) {
      setPendingCommunity(community);
      setSelectedAlias('');
    } else {
      doJoin(community.id, undefined);
    }
  };

  const doJoin = async (communityId: string, alias: string | undefined) => {
    setJoining(true);
    try {
      await joinCommunity(communityId, alias);
    } finally {
      setJoining(false);
      setPendingCommunity(null);
      setSelectedAlias('');
    }
  };

  const filteredCommunities = useMemo(() => {
    let result = communities;
    if (activeCategory !== 'All') {
      result = result.filter(c =>
        c.tags.some(t => t.toLowerCase().includes(activeCategory.toLowerCase()))
      );
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(c =>
        c.name.toLowerCase().includes(q) ||
        (c.description ?? '').toLowerCase().includes(q) ||
        c.tags.some(t => t.toLowerCase().includes(q))
      );
    }
    return result;
  }, [communities, activeCategory, search]);

  const featured = filteredCommunities[0] ?? null;
  const gridCommunities = filteredCommunities.slice(1);
  // A user joins as a person, so only offer Person-scoped aliases (e.g. "Founder").
  // Org-scoped aliases like "Portfolio Company" must never be selectable here.
  const aliases = aliasesForType(pendingCommunity?.communityAliases, 'Person');

  return (
    <div className="w-full min-h-screen bg-gradient-to-b from-surface-1 to-surface-2">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 pb-10">

        {/* Page header — centered title, consistent with other pages */}
        <PageTitle title="Discover Communities" />

        {/* Search bar — centered, sized to match Directory/Events/Resources */}
        <div className="flex justify-center pt-6">
          <div className="w-full max-w-2xl">
            <div className="flex min-h-[56px] items-center gap-2.5 rounded-2xl border border-border-default bg-surface-1 px-4 shadow-sm">
              <svg className="h-4 w-4 shrink-0 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search communities by name, description, or tags…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="flex-1 bg-transparent text-base text-text-primary placeholder:text-text-muted focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Category filters — centered below the search */}
        <div className="flex flex-wrap items-center justify-center gap-2 pt-4 mb-10">
          {CATEGORY_FILTERS.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-4 py-2 text-sm font-medium rounded-full transition-all duration-150 ${
                activeCategory === cat
                  ? 'bg-brand-green text-white shadow-md shadow-brand-green/20'
                  : 'bg-surface-1 text-text-secondary hover:bg-surface-2 border border-border-subtle'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {filteredCommunities.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-20 h-20 rounded-full bg-surface-2 flex items-center justify-center mb-4">
              <span className="text-4xl">🔍</span>
            </div>
            <p className="text-lg font-medium text-text-primary mb-1">No communities found</p>
            <p className="text-sm text-text-muted">Try a different search or category filter.</p>
          </div>
        ) : (
          <div className="space-y-12">

            {/* Featured community */}
            {featured && (
              <section>
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-lg font-semibold text-text-primary">Featured Community</h2>
                  <span className="text-sm text-text-muted">Hand-picked for you</span>
                </div>
                <div className="w-[260px] mx-auto">
                  <CommunityCard
                    community={featured}
                    joined={isJoined(featured.id)}
                    onJoin={handleJoin}
                    variant="featured"
                  />
                </div>
              </section>
            )}

            {/* All communities grid */}
            {gridCommunities.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-lg font-semibold text-text-primary">All Communities</h2>
                  <span className="text-sm text-text-muted">{gridCommunities.length} communities</span>
                </div>
                <div className="grid gap-6 justify-center" style={{ gridTemplateColumns: 'repeat(auto-fill, 260px)' }}>
                  {gridCommunities.map((community) => (
                    <CommunityCard
                      key={community.id}
                      community={community}
                      joined={isJoined(community.id)}
                      onJoin={handleJoin}
                    />
                  ))}
                </div>
              </section>
            )}

          </div>
        )}
      </div>

      {/* Alias selection modal */}
      {pendingCommunity && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => { setPendingCommunity(null); setSelectedAlias(''); }}
        >
          <div
            className="bg-surface-1 rounded-2xl shadow-2xl border border-border-subtle p-8 w-full max-w-md mx-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <CommunityAvatar name={pendingCommunity.name} imageUrl={pendingCommunity.imageUrl} size="md" />
              <div>
                <h2 className="text-lg font-semibold text-text-primary">How do you identify?</h2>
                <p className="text-xs text-text-muted">{pendingCommunity.name}</p>
              </div>
            </div>
            <p className="text-sm text-text-secondary mb-6">
              Choose your role so others in the community know who you are.
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
                onClick={() => { setPendingCommunity(null); setSelectedAlias(''); }}
                className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-full border border-border-default text-text-secondary hover:bg-surface-2 transition-all duration-200"
              >
                Cancel
              </button>
              <button
                onClick={() => doJoin(pendingCommunity.id, selectedAlias || undefined)}
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
