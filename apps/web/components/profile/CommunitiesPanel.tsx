'use client';

import React from 'react';
import { getInitials } from '@/lib/avatarUtils';

interface Community {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  memberCount?: number;
  role?: string;
}

interface CommunitiesPanelProps {
  communities: Community[];
}

export default function CommunitiesPanel({ communities }: CommunitiesPanelProps) {
  if (communities.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-4xl mb-3">🏘️</div>
        <p className="text-sm text-brand-grey">Not a member of any communities.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {communities.map((community) => (
        <div
          key={community.id}
          className="flex items-center gap-4 p-4 bg-surface-2 rounded-xl border border-border-subtle hover:border-border-default transition-colors cursor-pointer"
        >
          {community.imageUrl ? (
            <img
              src={community.imageUrl}
              alt={community.name}
              className="w-12 h-12 rounded-xl object-cover flex-shrink-0"
            />
          ) : (
            <div className="w-12 h-12 rounded-xl bg-brand-light-bg text-brand-dark-green flex items-center justify-center text-sm font-semibold flex-shrink-0">
              {getInitials(community.name)}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-brand-black">{community.name}</p>
            {community.description && (
              <p className="text-xs text-brand-grey line-clamp-1 mt-0.5">{community.description}</p>
            )}
            <div className="flex items-center gap-3 mt-1">
              {community.memberCount !== undefined && (
                <span className="text-xs text-brand-grey">{community.memberCount} members</span>
              )}
              {community.role && (
                <span className="text-xs font-medium text-brand-dark-green bg-brand-light-bg px-2 py-0.5 rounded-full capitalize">
                  {community.role}
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
