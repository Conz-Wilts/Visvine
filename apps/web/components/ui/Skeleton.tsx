import React from 'react';

interface SkeletonProps {
  /** Tailwind classes for size/shape/color. Defaults to a small rounded bar. */
  className?: string;
  style?: React.CSSProperties;
}

/**
 * A single shimmering placeholder block. Compose several to build skeleton
 * loaders (cards, table rows, etc.). Defaults to the `surface-muted` fill; pass
 * a `bg-*` class to override (e.g. `bg-line-subtle` for a solid block).
 */
export default function Skeleton({ className = '', style }: SkeletonProps) {
  const hasBg = /\bbg-/.test(className);
  return (
    <div
      className={`animate-pulse rounded ${hasBg ? '' : 'bg-surface-muted'} ${className}`}
      style={style}
      aria-hidden="true"
    />
  );
}
