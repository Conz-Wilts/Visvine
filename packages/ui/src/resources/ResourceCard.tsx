'use client';

import { clsx } from 'clsx';
import { useState, type ReactNode } from 'react';
import FileTypeIcon from './FileTypeIcon';

/** Kinds whose picture is a page, drawn as paper rather than a photo. */
const PAGED = new Set(['pdf', 'doc', 'slides', 'text']);

export interface ResourceCardProps {
  name: string;
  kind: string;
  meta?: string;
  thumbUrl?: string | null;
  onOpen?: () => void;
  selected?: boolean;
  select?: ReactNode;
  actions?: ReactNode;
  /**
   * `file`: a 4:3 picture over the name and facts. `image`: a square picture
   * and nothing else until hovered — the grid for choosing a logo.
   */
  variant?: 'file' | 'image';
}

/** One resource as a grid tile: its picture (or its kind's tile), its name, its facts. */
export default function ResourceCard({
  name,
  kind,
  meta,
  thumbUrl,
  onOpen,
  selected = false,
  select,
  actions,
  variant = 'file',
}: ResourceCardProps) {
  const [broken, setBroken] = useState(false);
  const picture = thumbUrl && !broken;
  const imageOnly = variant === 'image';
  return (
    <div className="group relative min-w-0">
      <button
        type="button"
        onClick={onOpen}
        aria-label={name}
        className={clsx(
          'relative block w-full overflow-hidden rounded-xl bg-surface-subtle ring-offset-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
          imageOnly ? 'aspect-square' : 'aspect-[4/3]',
          selected ? 'ring-2 ring-accent' : 'hover:brightness-[0.97]',
        )}
      >
        {picture && PAGED.has(kind) ? (
          // A document's first page, peeking from the tile like a sheet of paper.
          <img
            src={thumbUrl!}
            alt=""
            loading="lazy"
            onError={() => setBroken(true)}
            className="absolute inset-x-5 bottom-0 top-4 h-[calc(100%-1rem)] w-[calc(100%-2.5rem)] rounded-t-md bg-surface object-cover object-top shadow-float"
          />
        ) : picture ? (
          <img
            src={thumbUrl!}
            alt=""
            loading="lazy"
            onError={() => setBroken(true)}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center">
            <FileTypeIcon kind={kind} size="lg" />
          </span>
        )}
        {imageOnly && (
          <span className="absolute inset-x-0 bottom-0 translate-y-1 truncate bg-surface/90 px-2 py-1 text-left text-xs font-medium text-fg opacity-0 transition group-hover:translate-y-0 group-hover:opacity-100">
            {name}
          </span>
        )}
      </button>
      {select && <div className="absolute left-2 top-2">{select}</div>}
      {actions && <div className="absolute right-2 top-2 hidden items-center gap-0.5 rounded-lg bg-surface p-0.5 shadow-float group-hover:flex">{actions}</div>}
      {!imageOnly && (
        <button type="button" onClick={onOpen} className="mt-2 block w-full min-w-0 text-left focus:outline-none" tabIndex={-1}>
          <span className="block truncate text-sm font-medium text-fg">{name}</span>
          {meta && <span className="block truncate text-xs text-fg-muted">{meta}</span>}
        </button>
      )}
    </div>
  );
}
