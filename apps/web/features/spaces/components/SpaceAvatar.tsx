'use client';

import Avatar from '@/components/ui/Avatar';

interface SpaceAvatarProps {
  name: string;
  imageUrl?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  /** Tailwind rounding utility; override to keep the corner ratio consistent at custom sizes. */
  rounded?: string;
  className?: string;
}

// Space avatars use their own size scale (with matching initials text sizes),
// so they pass it through ui/Avatar's sizeClassName override.
const SIZE_CLASSES = {
  // `xs` is the 16px glyph size the trees draw at, so a space can stand in a
  // row beside folder and entity glyphs without setting the row's height.
  xs: 'w-4 h-4 text-[8px]',
  sm: 'w-6 h-6 text-xs',
  md: 'w-8 h-8 text-sm',
  lg: 'w-12 h-12 text-lg',
  xl: 'w-16 h-16 text-2xl',
};

/** Intrinsic px matching SIZE_CLASSES, forwarded so next/image knows the size. */
const SIZE_PX: Record<keyof typeof SIZE_CLASSES, number> = {
  xs: 16,
  sm: 24,
  md: 32,
  lg: 48,
  xl: 64,
};

export default function SpaceAvatar({ name, imageUrl, size = 'md', rounded = 'rounded-xl', className = '' }: SpaceAvatarProps) {
  return (
    <Avatar
      name={name}
      imageUrl={imageUrl}
      fallback="space"
      // Rounded square to match the profile/person avatar style, rather than a circle.
      sizeClassName={`${rounded} ${SIZE_CLASSES[size]}`}
      pixelSize={SIZE_PX[size]}
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
