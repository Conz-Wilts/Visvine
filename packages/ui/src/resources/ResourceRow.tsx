'use client';

import { clsx } from 'clsx';
import { useState, type ReactNode } from 'react';
import FileTypeIcon from './FileTypeIcon';

export interface ResourceRowProps {
  name: string;
  kind: string;
  /** One muted line of facts joined by `·` — `Ana · #brand · 3d`. */
  meta?: string;
  /** A small image of the resource; the kind's tile when absent or broken. */
  thumbUrl?: string | null;
  onOpen?: () => void;
  selected?: boolean;
  /** Shown on hover (and while selecting): Download, Share, the overflow. */
  actions?: ReactNode;
  /** A checkbox for bulk select, drawn at the start. */
  select?: ReactNode;
  density?: 'comfortable' | 'compact';
}

/**
 * One resource as a list row: its thumbnail or kind tile, its name, one muted
 * line of facts, and its actions on hover. Hairline-separated by the list,
 * flat, never a card.
 */
export default function ResourceRow({
  name,
  kind,
  meta,
  thumbUrl,
  onOpen,
  selected = false,
  actions,
  select,
  density = 'comfortable',
}: ResourceRowProps) {
  const [broken, setBroken] = useState(false);
  const compact = density === 'compact';
  return (
    <div
      className={clsx(
        'group relative flex items-center gap-3 rounded-lg px-2 transition-colors',
        compact ? 'py-1.5' : 'py-2',
        selected ? 'bg-accent-soft' : 'hover:bg-surface-subtle',
      )}
    >
      {select}
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left focus:outline-none">
        {thumbUrl && !broken ? (
          <img
            src={thumbUrl}
            alt=""
            loading="lazy"
            onError={() => setBroken(true)}
            className={clsx('shrink-0 rounded-lg bg-surface-subtle object-cover', compact ? 'h-7 w-7' : 'h-9 w-9')}
          />
        ) : (
          <FileTypeIcon kind={kind} size={compact ? 'sm' : 'md'} />
        )}
        <span className="min-w-0 flex-1">
          <span className={clsx('block truncate font-medium text-fg', compact ? 'text-sm' : 'text-[15px]')}>{name}</span>
          {meta && !compact && <span className="block truncate text-xs text-fg-muted">{meta}</span>}
        </span>
      </button>
      {actions && (
        <div className={clsx('flex shrink-0 items-center gap-0.5', selected ? 'flex' : 'hidden group-hover:flex group-focus-within:flex')}>
          {actions}
        </div>
      )}
    </div>
  );
}
