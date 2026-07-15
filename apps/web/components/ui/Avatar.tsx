import type { CSSProperties } from 'react';
import { getInitials } from '@/lib/avatarUtils';
import PersonSilhouette from './PersonSilhouette';

// Square avatars (rounded-xl/lg) — matches profile imagery across the app
// (directory, full-profile overlay, mutual-connection cards).
const SIZE_CLASSES = {
  xs: 'h-6 w-6 rounded-lg',
  sm: 'h-8 w-8 rounded-lg',
  md: 'h-9 w-9 rounded-xl',
  /** Used in modals/chips for tight spaces */
  chip: 'h-7 w-7 rounded-lg',
  lg: 'h-11 w-11 rounded-xl',
  xl: 'h-12 w-12 rounded-xl',
};

/** Initials text size per built-in size (only used with fallback="initials"). */
const INITIALS_TEXT_CLASSES: Record<keyof typeof SIZE_CLASSES, string> = {
  xs: 'text-xs',
  sm: 'text-sm',
  md: 'text-sm',
  chip: 'text-xs',
  lg: 'text-base',
  xl: 'text-base',
};

interface AvatarProps {
  name: string;
  imageUrl?: string | null;
  size?: keyof typeof SIZE_CLASSES;
  /** Tint for the silhouette fallback. Defaults to brand green when omitted. */
  accentColor?: string;
  className?: string;
  /**
   * What to render when there's no image: a person silhouette (default) or the
   * entity's initials on a brand-green tile (used for communities).
   */
  fallback?: 'silhouette' | 'initials';
  /**
   * Fully replaces the built-in size map — supply dimensions, rounding, and
   * (for initials) text-size classes. Lets wrappers with their own size scale
   * (e.g. CommunityAvatar) reuse this component.
   */
  sizeClassName?: string;
  /** Inline styles forwarded to the rendered element. */
  style?: CSSProperties;
}

export default function Avatar({
  name,
  imageUrl,
  size = 'md',
  accentColor,
  className = '',
  fallback = 'silhouette',
  sizeClassName,
  style,
}: AvatarProps) {
  const cls = sizeClassName ?? SIZE_CLASSES[size];
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={name}
        className={`${cls} object-cover shrink-0 ${className}`}
        style={style}
      />
    );
  }
  if (fallback === 'initials') {
    const textCls = sizeClassName ? '' : ` ${INITIALS_TEXT_CLASSES[size]}`;
    return (
      <div
        role="img"
        aria-label={name}
        className={`${cls}${textCls} shrink-0 bg-brand-green flex items-center justify-center font-semibold text-white ${className}`}
        style={style}
      >
        {getInitials(name)}
      </div>
    );
  }
  return (
    <div
      role="img"
      aria-label={name}
      className={`shrink-0 overflow-hidden ${cls} ${className}`}
      style={style}
    >
      <PersonSilhouette color={accentColor} />
    </div>
  );
}
