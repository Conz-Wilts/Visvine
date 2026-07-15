'use client';

import React from 'react';

interface ActivityItem {
  id: string;
  type: 'connected' | 'joined_community' | 'event_attendance' | 'profile_updated';
  description: string;
  timestamp: string;
  avatarUrl?: string;
  avatarInitials?: string;
}

interface ActivityFeedProps {
  items: ActivityItem[];
  loading?: boolean;
}

// Intentionally local (not lib/date.ts): this surface's hybrid output
// ("Just now" / "N hours ago" / "Mar 5" / "Mar 2024") matches no shared style.
function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = diffHours / 24;

  if (diffHours < 24) {
    const h = Math.floor(diffHours);
    return h <= 1 ? 'Just now' : `${h} hours ago`;
  }
  if (diffDays < 30) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

const TYPE_ICONS: Record<ActivityItem['type'], string> = {
  connected: '🔗',
  joined_community: '🏘️',
  event_attendance: '📅',
  profile_updated: '✏️',
};

export default function ActivityFeed({ items, loading }: ActivityFeedProps) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-start gap-3 animate-pulse">
            <div className="w-8 h-8 rounded-full bg-surface-3 flex-shrink-0" />
            <div className="flex-1 space-y-1">
              <div className="h-3 w-3/4 bg-gray-200 rounded" />
              <div className="h-3 w-1/4 bg-gray-200 rounded" />
            </div>
          </div>
        ))}
        <p className="text-xs text-brand-grey text-center">Loading activity...</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-4xl mb-3">📋</div>
        <p className="text-sm text-brand-grey">No activity yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <div key={item.id} className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center text-sm flex-shrink-0">
            {TYPE_ICONS[item.type]}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-brand-grey leading-relaxed">{item.description}</p>
            <p className="text-[10px] text-brand-grey/70 mt-0.5">{formatTimestamp(item.timestamp)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
