import type { CSSProperties } from 'react';
import Image from 'next/image';
import { getInitials } from '@/lib/avatarUtils';
import { isOptimizableImageUrl } from '@/lib/mediaUrl';
import PersonSilhouette from './PersonSilhouette';
import { SpaceIcon } from '@/features/shared/icons';

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

/** Intrinsic pixel size per built-in size (next/image width/height). */
const SIZE_PX: Record<keyof typeof SIZE_CLASSES, number> = {
  xs: 24,
  sm: 32,
  md: 36,
  chip: 28,
  lg: 44,
  xl: 48,
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
  /** Tint for the silhouette fallback. Defaults to the theme accent when omitted. */
  accentColor?: string;
  className?: string;
  /**
   * What to render when there's no image: a person silhouette (default) or the
   * entity's initials on a brand-green tile (used for spaces).
   */
  fallback?: 'silhouette' | 'initials' | 'space';
  /**
   * Fully replaces the built-in size map — supply dimensions, rounding, and
   * (for initials) text-size classes. Lets wrappers with their own size scale
   * (e.g. SpaceAvatar) reuse this component.
   */
  sizeClassName?: string;
  /**
   * Intrinsic pixel size for next/image when `sizeClassName` overrides the
   * built-in size map (which otherwise derives it). Square avatars only need
   * one number.
   */
  pixelSize?: number;
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
  pixelSize,
  style,
}: AvatarProps) {
  const cls = sizeClassName ?? SIZE_CLASSES[size];
  if (imageUrl) {
    // Local blob previews / inline data URLs can't go through next/image.
    if (imageUrl.startsWith('data:') || imageUrl.startsWith('blob:')) {
      return (
        <img
          src={imageUrl}
          alt={name}
          className={`${cls} object-cover shrink-0 ${className}`}
          style={style}
        />
      );
    }
    const px = pixelSize ?? SIZE_PX[size];
    return (
      <Image
        src={imageUrl}
        alt={name}
        width={px}
        height={px}
        // The optimizer re-encodes what the upload already wrote as WebP, and
        // at the default 75 that second pass is what shows on a face.
        quality={90}
        className={`${cls} object-cover shrink-0 ${className}`}
        style={style}
        // Hosts outside next.config remotePatterns (e.g. the server-only GCS
        // CDN hostname) render unoptimized rather than throwing.
        unoptimized={!isOptimizableImageUrl(imageUrl)}
      />
    );
  }
  if (fallback === 'space') {
    // A space with no logo is drawn as a space, not as its own initials: the
    // cornered square, the mark every surface gives a space (see NODE_GLYPH_PATHS).
    return (
      <div
        role="img"
        aria-label={name}
        className={`${cls} shrink-0 bg-brand-green flex items-center justify-center text-white ${className}`}
        style={style}
      >
        <SpaceIcon className="w-[55%] h-[55%]" />
      </div>
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
