'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { tokenize, scoreCandidate } from '@/features/search/utils';
import CommunityAvatar from '@/components/community/CommunityAvatar';

export default function CommunitySelector({
  iconOnly = false,
}: {
  iconOnly?: boolean;
}) {
  const { currentCommunity, joinedCommunities, setCurrentCommunity } = useCommunity();
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredCommunities = useMemo(() => {
    let filtered = joinedCommunities;
    if (searchQuery.trim()) {
      const queryTokens = tokenize(searchQuery);
      filtered = joinedCommunities.filter(community => {
        if (scoreCandidate(queryTokens, tokenize(community.name)) > 0) return true;
        if (scoreCandidate(queryTokens, tokenize(community.description)) > 0) return true;
        return (community.tags || []).some(tag => scoreCandidate(queryTokens, tokenize(tag)) > 0);
      });
    }
    return filtered;
  }, [joinedCommunities, searchQuery]);

  const handleSelect = (communityId: string) => {
    setCurrentCommunity(communityId);
    setIsOpen(false);
    setSearchQuery('');
  };

  return (
    <div className="relative">
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={
          iconOnly
            ? "w-12 h-12 rounded-2xl flex items-center justify-center border border-border-subtle bg-surface-1 hover:bg-surface-2 transition shadow-float"
            : "flex items-center gap-2 h-12 px-3 text-sm font-medium text-text-secondary border border-border-default rounded-2xl bg-surface-1 hover:bg-surface-2 transition shadow-float"
        }
      >
        {currentCommunity ? (
          <CommunityAvatar name={currentCommunity.name} imageUrl={currentCommunity.imageUrl} size="sm" className="!w-8 !h-8 !text-sm" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-surface-3 flex-shrink-0" />
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
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />

          <div className="absolute left-0 mt-2 w-80 bg-surface-1 rounded-2xl shadow-xl border border-border-subtle z-50 overflow-hidden">
            {/* Search Input */}
            <div className="p-3 border-b border-border-subtle">
              <input
                type="text"
                placeholder="Search communities..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border-default rounded-xl bg-surface-2 text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-default transition"
                autoFocus
              />
            </div>

            {/* Communities List */}
            <div className="max-h-96 overflow-y-auto">
              {filteredCommunities.length === 0 ? (
                <div className="p-4 text-sm text-text-muted text-center">No communities found</div>
              ) : (
                filteredCommunities.map((community) => (
                  <button
                    key={community.id}
                    onClick={() => handleSelect(community.id)}
                    className={`w-full px-4 py-3 flex items-start gap-3 hover:bg-surface-2 transition text-left ${
                      currentCommunity?.id === community.id ? 'bg-surface-2' : ''
                    }`}
                  >
                    <CommunityAvatar name={community.name} imageUrl={community.imageUrl} size="md" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-text-primary">{community.name}</span>
                        {currentCommunity?.id === community.id && (
                          <svg className="w-4 h-4 text-brand-green" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </div>
                      <p className="text-xs text-text-muted truncate">{community.description}</p>
                      <div className="flex items-center gap-2 mt-1">
                        {community.location && (
                          <span className="text-xs text-text-muted flex items-center gap-1">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            {community.location}
                          </span>
                        )}
                        <span className="text-xs text-text-muted flex items-center gap-1">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                          </svg>
                          {community.memberCount}
                        </span>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="p-2 border-t border-border-subtle bg-surface-2">
              <Link
                href="/communities"
                className="block w-full px-3 py-2 text-sm text-center text-text-secondary hover:text-text-primary font-medium hover:bg-surface-3 rounded-md transition"
                onClick={() => setIsOpen(false)}
              >
                My Communities
              </Link>
              <Link
                href="/discover"
                className="block w-full px-3 py-2 text-sm text-center text-brand-green hover:text-brand-dark-green font-medium"
                onClick={() => setIsOpen(false)}
              >
                Discover More Communities →
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
