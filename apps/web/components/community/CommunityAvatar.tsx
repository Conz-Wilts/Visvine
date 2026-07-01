'use client';

import React from 'react';

interface CommunityAvatarProps {
  name: string;
  imageUrl?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Tailwind rounding utility; override to keep the corner ratio consistent at custom sizes. */
  rounded?: string;
  className?: string;
}

const SIZE_CLASSES = {
  sm: 'w-6 h-6 text-xs',
  md: 'w-8 h-8 text-sm',
  lg: 'w-12 h-12 text-lg',
  xl: 'w-16 h-16 text-2xl',
};

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');
}

export default function CommunityAvatar({ name, imageUrl, size = 'md', rounded = 'rounded-xl', className = '' }: CommunityAvatarProps) {
  const sizeClass = SIZE_CLASSES[size];
  // Rounded square to match the profile/person avatar style (see ui/Avatar.tsx),
  // rather than a circle.
  const base = `${rounded} object-cover flex-shrink-0 ${sizeClass} ${className}`;

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={name}
        className={`${base} object-cover`}
        style={{ width: className.includes('w-full') ? '100%' : undefined, height: className.includes('h-full') ? '100%' : undefined }}
      />
    );
  }

  return (
    <div className={`${base} bg-brand-green flex items-center justify-center font-semibold text-white`}>
      {getInitials(name)}
    </div>
  );
}
