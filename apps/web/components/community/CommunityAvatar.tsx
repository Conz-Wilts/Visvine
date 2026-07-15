'use client';

import Avatar from '@/components/ui/Avatar';

interface CommunityAvatarProps {
  name: string;
  imageUrl?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Tailwind rounding utility; override to keep the corner ratio consistent at custom sizes. */
  rounded?: string;
  className?: string;
}

// Community avatars use their own size scale (with matching initials text sizes),
// so they pass it through ui/Avatar's sizeClassName override.
const SIZE_CLASSES = {
  sm: 'w-6 h-6 text-xs',
  md: 'w-8 h-8 text-sm',
  lg: 'w-12 h-12 text-lg',
  xl: 'w-16 h-16 text-2xl',
};

export default function CommunityAvatar({ name, imageUrl, size = 'md', rounded = 'rounded-xl', className = '' }: CommunityAvatarProps) {
  return (
    <Avatar
      name={name}
      imageUrl={imageUrl}
      fallback="initials"
      // Rounded square to match the profile/person avatar style, rather than a circle.
      sizeClassName={`${rounded} ${SIZE_CLASSES[size]}`}
      className={className}
      // Callers stretch the avatar with w-full/h-full utilities that would otherwise
      // lose to the fixed size classes; inline styles guarantee the stretch wins.
      style={
        imageUrl
          ? {
              width: className.includes('w-full') ? '100%' : undefined,
              height: className.includes('h-full') ? '100%' : undefined,
            }
          : undefined
      }
    />
  );
}
