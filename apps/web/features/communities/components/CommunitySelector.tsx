'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import CommunityAvatar from '@/components/community/CommunityAvatar';

// Predictable, ranked matching for the community switcher. Name-only (like the main
// directory search) so it stays predictable — these are communities you already know
// by name, and matching descriptions made every venture firm match "ven".
// Ranking: exact > prefix > word-start > substring. Returns -Infinity for no match.
function scoreCommunity(name: string, query: string): number {
  const lower = name.toLowerCase();
  if (lower === query) return 100000;
  if (lower.startsWith(query)) return 90000 - query.length;
  // Any word in the name starts with the query, e.g. "ven" → "Blackbird Ventures".
  if (lower.split(/[^a-z0-9]+/).some(word => word.startsWith(query))) {
    return 80000 - lower.indexOf(query);
  }
  const idx = lower.indexOf(query);
  if (idx > 0) return 70000 - idx * 10;
  return -Infinity;
}

export default function CommunitySelector({
  iconOnly = false,
}: {
  iconOnly?: boolean;
}) {
  const { currentCommunity, joinedCommunities, setCurrentCommunity } = useCommunity();
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Close the dropdown when clicking anywhere outside it (including other top-bar items).
  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen]);

  const filteredCommunities = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return joinedCommunities;
    return joinedCommunities
      .map(community => ({ community, score: scoreCommunity(community.name, query) }))
      .filter(({ score }) => score > -Infinity)
      .sort((a, b) => b.score - a.score)
      .map(({ community }) => community);
  }, [joinedCommunities, searchQuery]);

  const handleSelect = (communityId: string) => {
    setCurrentCommunity(communityId);
    setIsOpen(false);
    setSearchQuery('');
  };

  return (
    <div className="relative" ref={containerRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={
          iconOnly
            ? "w-12 h-12 rounded-xl flex items-center justify-center border border-border-default bg-surface-1 hover:bg-surface-2 transition shadow-float"
            : "flex items-center gap-2 h-12 px-3 text-sm font-medium text-text-secondary border border-border-default rounded-xl bg-surface-1 hover:bg-surface-2 transition shadow-float"
        }
      >
        {currentCommunity ? (
          <CommunityAvatar name={currentCommunity.name} imageUrl={currentCommunity.imageUrl} size="sm" className="!w-8 !h-8 !text-sm" />
        ) : (
          <div className="w-8 h-8 rounded-xl bg-surface-3 flex-shrink-0" />
        )}
        {!iconOnly && (
          <>
            <span className="hidden md:inline font-ginto">{currentCommunity?.name || 'Select Community'}</span>
            <svg
              className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </>
        )}
      </button>

      {isOpen && (
        <div className="absolute left-0 mt-2 w-80 bg-surface-1 rounded-2xl shadow-xl border border-border-subtle z-50 overflow-hidden">
            {/* Search Input */}
            <div className="p-3 border-b border-border-subtle">
              <div className="flex min-h-[40px] items-center gap-2 rounded-xl border border-border-default bg-surface-1 px-3 shadow-sm focus-within:border-brand-green transition-colors">
                <svg className="h-3.5 w-3.5 shrink-0 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search communities…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
                  autoFocus
                />
              </div>
            </div>

            {/* Communities List — caps at 5 rows (~56px each) before scrolling */}
            <div className="max-h-[280px] overflow-y-auto custom-scrollbar">
              {filteredCommunities.length === 0 ? (
                <div className="p-4 text-sm text-text-muted text-center">No communities found</div>
              ) : (
                filteredCommunities.map((community) => (
                  <button
                    key={community.id}
                    onClick={() => handleSelect(community.id)}
                    className={`w-full px-4 py-3 flex items-center gap-3 hover:bg-surface-2 transition text-left ${
                      currentCommunity?.id === community.id ? 'bg-surface-2' : ''
                    }`}
                  >
                    <CommunityAvatar name={community.name} imageUrl={community.imageUrl} size="md" />
                    <span className="flex-1 min-w-0 font-medium text-sm text-text-primary truncate">{community.name}</span>
                    {currentCommunity?.id === community.id && (
                      <svg className="w-5 h-5 shrink-0 text-brand-green" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="p-2 border-t border-border-subtle bg-surface-2">
              <Link
                href="/discover"
                className="flex w-full items-center justify-center gap-2 px-3 py-2 text-sm text-center text-brand-green hover:text-brand-dark-green font-medium"
                onClick={() => setIsOpen(false)}
              >
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="9" strokeWidth={2} />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
                </svg>
                Discover Communities
              </Link>
            </div>
          </div>
      )}
    </div>
  );
}
