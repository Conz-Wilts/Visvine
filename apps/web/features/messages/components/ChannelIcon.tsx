'use client';

/**
 * ChannelIcon — a channel's icon, falling back to the classic hashtag.
 * ChannelIconPicker — the popover for choosing it.
 *
 * These used to store an emoji, with a free-form "any emoji" input beside a
 * curated grid. Emoji render differently on every OS (and several of the old
 * curated set have no glyph at all on Windows), so a channel's icon now names
 * one of the icons we own — see docs/icons.md. The picker is the whole
 * vocabulary: there is no free-form field, because the set of valid names is
 * exactly what we ship, and the API validates against it.
 */

import { useEffect, useRef, useState } from 'react';
import { HashIcon, Icon, NewspaperIcon } from '@/features/shared/icons';

export function ChannelIcon({ icon, fallback = 'hash', className = 'h-4 w-4' }: {
  icon?: string | null;
  /** Glyph when no icon is set — 'feed' marks feed-style channels. */
  fallback?: 'hash' | 'feed';
  className?: string;
}) {
  if (icon) {
    return <Icon name={icon} className={`shrink-0 ${className}`} strokeWidth={2} />;
  }
  if (fallback === 'feed') {
    return <NewspaperIcon className={`shrink-0 ${className}`} strokeWidth={2} />;
  }
  return <HashIcon className={`shrink-0 ${className}`} strokeWidth={2} />;
}

/**
 * The icons a channel may pick from — a curated slice of the set, not all 135.
 * Deliberately the same size and spirit as the emoji grid it replaces (32
 * shapes, four rows of eight), so a space that had picked emoji has a near
 * equivalent to land on. Order matters: it is the order of the grid.
 */
export const CHANNEL_ICONS = [
  'message-circle', 'megaphone', 'pin', 'target', 'rocket', 'lightbulb', 'flame', 'star',
  'party-popper', 'handshake', 'brain', 'book-open', 'trending-up', 'briefcase', 'hammer', 'palette',
  'sprout', 'coffee', 'pizza', 'gamepad-2', 'trophy', 'heart', 'hand', 'bell',
  'vote', 'compass', 'earth', 'music', 'camera', 'house', 'coins', 'bot',
] as const;

export function ChannelIconPicker({
  onSelect,
  onClear,
  onClose,
  clearLabel = 'Use # default',
}: {
  onSelect: (icon: string) => void;
  /** Omit to hide the reset row (e.g. when creating, where # is already the default). */
  onClear?: () => void;
  onClose: () => void;
  clearLabel?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div ref={ref} className="w-56 rounded-2xl border border-border-subtle bg-surface-1 p-2 shadow-float">
      <div className="grid grid-cols-8 gap-0.5">
        {CHANNEL_ICONS.map((name) => (
          <button
            key={name}
            type="button"
            title={name.replace(/-/g, ' ')}
            onClick={() => { onSelect(name); onClose(); }}
            onMouseEnter={() => setHovered(name)}
            onMouseLeave={() => setHovered((h) => (h === name ? null : h))}
            className="flex items-center justify-center rounded-lg p-1 text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
          >
            <Icon name={name} className="h-4 w-4" strokeWidth={2} />
          </button>
        ))}
      </div>
      {/* The grid is shapes, not words — this is how you find out what one is. */}
      <p className="mt-1.5 h-4 truncate px-1 text-[11px] leading-4 text-text-muted">
        {hovered ? hovered.replace(/-/g, ' ') : ''}
      </p>
      {onClear && (
        <button
          type="button"
          onClick={() => { onClear(); onClose(); }}
          className="mt-1 flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text-secondary"
        >
          <HashIcon className="h-3.5 w-3.5" strokeWidth={2} />
          {clearLabel}
        </button>
      )}
    </div>
  );
}
