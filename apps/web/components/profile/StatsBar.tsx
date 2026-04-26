'use client';

import React from 'react';

interface StatsBarProps {
  connectionCount: number;
  communityCount: number;
  memberSince?: string;
  onConnectionsClick?: () => void;
  onCommunitiesClick?: () => void;
}

function formatMemberSince(isoDate?: string): string {
  if (!isoDate) return '—';
  const d = new Date(isoDate);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export default function StatsBar({
  connectionCount,
  communityCount,
  memberSince,
  onConnectionsClick,
  onCommunitiesClick,
}: StatsBarProps) {
  const showConnectionCount = connectionCount >= 5;

  return (
    <div className="flex items-center gap-0 divide-x divide-border-subtle">
      {/* Connections */}
      <button
        onClick={onConnectionsClick}
        className="pr-4 text-left group"
        disabled={!onConnectionsClick}
      >
        {showConnectionCount ? (
          <span className="text-lg font-semibold text-brand-black group-hover:underline">
            {connectionCount}
          </span>
        ) : (
          <span className="text-xs font-medium text-brand-dark-green bg-brand-light-bg px-2 py-0.5 rounded-full">
            New member
          </span>
        )}
        {showConnectionCount && (
          <p className="text-xs text-brand-grey uppercase tracking-wide mt-0.5">Connections</p>
        )}
      </button>

      {/* Communities */}
      {communityCount > 0 && (
        <button
          onClick={onCommunitiesClick}
          className="px-4 text-left group"
          disabled={!onCommunitiesClick}
        >
          <span className="text-lg font-semibold text-brand-black group-hover:underline">
            {communityCount}
          </span>
          <p className="text-xs text-brand-grey uppercase tracking-wide mt-0.5">
            {communityCount === 1 ? 'Community' : 'Communities'}
          </p>
        </button>
      )}

      {/* Member Since */}
      {memberSince && (
        <div className="pl-4">
          <span className="text-lg font-semibold text-brand-black">
            {formatMemberSince(memberSince)}
          </span>
          <p className="text-xs text-brand-grey uppercase tracking-wide mt-0.5">Member Since</p>
        </div>
      )}
    </div>
  );
}
