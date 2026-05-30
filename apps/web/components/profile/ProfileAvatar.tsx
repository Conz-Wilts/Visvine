'use client';

import React from 'react';
import { getTypeColor } from '@/components/dashboard/typeStyles';
import { getInitials } from '@/lib/avatarUtils';

interface ProfileAvatarProps {
  name: string;
  nodeType: string;
  imageUrl?: string;
  size: 'sm' | 'md' | 'lg';
  isOwner?: boolean;
  onClick?: () => void;
}

// Square sizes — lg is deliberately large for the full-page CV look
const SIZE_CLASSES = {
  sm: { dim: 'w-16 h-16', text: 'text-lg' },
  md: { dim: 'w-20 h-20', text: 'text-xl' },
  lg: { dim: 'w-44 h-44', text: 'text-4xl' },
};

export default function ProfileAvatar({
  name,
  nodeType,
  imageUrl,
  size,
  isOwner,
  onClick,
}: ProfileAvatarProps) {
  const { dim, text } = SIZE_CLASSES[size];
  const typeColor = getTypeColor(nodeType);
  const initials = getInitials(name);

  return (
    <div
      className={`
        relative ${dim} rounded-full
        ring-4 ring-surface-1
        flex-shrink-0
        overflow-hidden
        shadow-lg
        transition-transform duration-150
        hover:scale-[1.02]
        ${onClick ? 'cursor-pointer' : ''}
        group
      `}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={`Profile photo of ${name}`}
          className="w-full h-full object-cover"
        />
      ) : (
        <>
          <div
            className={`w-full h-full flex items-center justify-center font-bold text-white ${text}`}
            style={{ backgroundColor: typeColor }}
            aria-hidden="true"
          >
            {initials}
          </div>
          <span className="sr-only">Profile photo of {name} (no image)</span>
        </>
      )}

      {isOwner && (
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center justify-center">
          <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
      )}
    </div>
  );
}
