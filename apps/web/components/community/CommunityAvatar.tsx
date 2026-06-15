'use client';

import React from 'react';

interface CommunityAvatarProps {
  name: string;
  imageUrl?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZE_CLASSES = {
  sm: 'w-6 h-6 text-xs',
  md: 'w-8 h-8 text-sm',
  lg: 'w-12 h-12 text-lg',
  xl: 'w-16 h-16 text-2xl',
};

// Generate a deterministic background color from a community name
function getAvatarColor(name: string): string {
  const colors = [
    'bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-amber-500',
    'bg-rose-500', 'bg-cyan-500', 'bg-indigo-500', 'bg-teal-500',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');
}

export default function CommunityAvatar({ name, imageUrl, size = 'md', className = '' }: CommunityAvatarProps) {
  const sizeClass = SIZE_CLASSES[size];
  // Rounded square to match the profile/person avatar style (see ui/Avatar.tsx),
  // rather than a circle.
  const base = `rounded-xl object-cover flex-shrink-0 ${sizeClass} ${className}`;

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
    <div className={`${base} ${getAvatarColor(name)} flex items-center justify-center font-semibold text-white`}>
      {getInitials(name)}
    </div>
  );
}
