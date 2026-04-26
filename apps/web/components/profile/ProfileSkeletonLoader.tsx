'use client';

import React from 'react';

interface ProfileSkeletonLoaderProps {
  mode?: 'sidebar' | 'fullpage';
}

export default function ProfileSkeletonLoader({ mode = 'fullpage' }: ProfileSkeletonLoaderProps) {
  const bannerH = mode === 'fullpage' ? 'h-[220px]' : 'h-24';
  const avatarSize = mode === 'fullpage' ? 'w-28 h-36' : 'w-20 h-[104px]';
  const avatarOffset = mode === 'fullpage' ? '-mt-16' : '-mt-12';

  return (
    <div className="w-full animate-pulse">
      <style>{`
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .skeleton-shimmer { animation: none !important; }
        }
      `}</style>

      {/* Banner */}
      <div className={`w-full ${bannerH} rounded-t-2xl bg-surface-3`} />

      {/* Avatar — portrait rectangle, overlapping banner */}
      <div className={`px-6 ${avatarOffset}`}>
        <div className={`${avatarSize} rounded-2xl bg-surface-3 ring-4 ring-surface-1`} />
      </div>

      {/* Identity */}
      <div className="px-6 pt-4 space-y-3">
        {/* Badge */}
        <div className="h-5 w-16 rounded-full bg-surface-3" />
        {/* Name */}
        <div className="h-7 w-48 rounded bg-surface-3" />
        {/* Role */}
        <div className="h-4 w-36 rounded bg-surface-3" />
        {/* Location */}
        <div className="h-4 w-28 rounded bg-surface-3" />
        {/* CTAs */}
        <div className="flex gap-3 pt-1">
          <div className="h-10 w-28 rounded-xl bg-surface-3" />
          <div className="h-10 w-28 rounded-xl bg-surface-3" />
        </div>
        {/* Stats */}
        <div className="flex gap-4 pt-1">
          <div className="h-10 w-16 rounded bg-surface-3" />
          <div className="h-10 w-16 rounded bg-surface-3" />
          <div className="h-10 w-20 rounded bg-surface-3" />
        </div>
      </div>

      {/* Bio lines */}
      <div className="px-6 pt-6 space-y-2">
        <div className="h-4 w-[80%] rounded bg-surface-3" />
        <div className="h-4 w-[90%] rounded bg-surface-3" />
        <div className="h-4 w-[55%] rounded bg-surface-3" />
      </div>

      {/* Tab placeholders */}
      {mode === 'fullpage' && (
        <div className="px-6 mt-6 flex gap-6 border-t border-border-subtle pt-4">
          <div className="h-4 w-14 rounded bg-surface-3" />
          <div className="h-4 w-24 rounded bg-surface-3" />
          <div className="h-4 w-20 rounded bg-surface-3" />
          <div className="h-4 w-16 rounded bg-surface-3" />
        </div>
      )}
    </div>
  );
}
