'use client';

/**
 * How a section's rows are drawn. One row component: the kind decides which of
 * its facts are there, so a timeline entry and a link are the same row wearing
 * what they hold.
 *
 * A row that points at a space draws that space and opens it; otherwise its own
 * picture, otherwise nothing but the words.
 */

import { ExternalLinkIcon, GripVerticalIcon, PencilIcon, Trash2Icon } from '@/features/shared/icons';
import SpaceAvatar from '@/features/spaces/components/SpaceAvatar';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { hostname } from '../profileCards';
import { fieldsFor } from '@/lib/profile/shared/sections';
import type { ProfileSectionEntryView } from '@/lib/profile/sections';

interface RowProps {
  entry: ProfileSectionEntryView;
  kind: string;
  isOwner: boolean;
  onEdit: () => void;
  onRemove: () => void;
  gripProps: Record<string, unknown>;
  dragging: boolean;
  /** Set by the reorder hook so it can find this row under the pointer. */
  'data-row-key'?: string;
}

export default function SectionRow({ entry, kind, isOwner, onEdit, onRemove, gripProps, dragging, ...rest }: RowProps) {
  const { setCurrentSpace } = useSpace();
  // Only what this kind draws: a row keeps its columns, the kind decides which
  // of them are this section's business.
  const drawn = new Set<string>(fieldsFor(kind));
  const years = drawn.has('startYear')
    ? [entry.startYear, entry.endYear ?? (entry.startYear ? 'Present' : null)].filter(Boolean).join(' – ')
    : '';
  const title = entry.title || entry.space?.name || 'Untitled';

  const mark = entry.space
    ? <SpaceAvatar name={entry.space.name} imageUrl={entry.space.imageUrl ?? undefined} size="lg" rounded="rounded-lg" />
    : entry.imageUrl
      ? <img src={entry.imageUrl} alt="" className="w-12 h-12 rounded-lg object-cover" />
      : null;

  const heading = kind === 'links' && entry.url ? (
    <a href={entry.url} target="_blank" rel="noopener noreferrer"
       className="inline-flex items-center gap-1.5 text-[15px] font-bold font-open-sauce text-text-primary hover:underline">
      {title}<ExternalLinkIcon className="w-3.5 h-3.5 text-text-muted" />
    </a>
  ) : entry.space ? (
    <button type="button" onClick={() => setCurrentSpace(entry.space!.id)}
            className="text-[15px] font-bold font-open-sauce text-text-primary hover:underline">
      {title}
    </button>
  ) : (
    <div className="text-[15px] font-bold font-open-sauce text-text-primary">{title}</div>
  );

  return (
    <li {...rest} className={`group flex gap-3 py-3 first:pt-0 last:pb-0 ${dragging ? 'opacity-60' : ''}`}>
      {mark && <span className="flex-none">{mark}</span>}
      <div className="min-w-0 flex-1">
        {heading}
        {drawn.has('subtitle') && entry.subtitle && <div className="text-sm text-text-secondary">{entry.subtitle}</div>}
        {years && <div className="text-sm text-text-muted">{years}</div>}
        {kind === 'links' && entry.url && (
          <div className="text-sm text-text-muted">{hostname(entry.url)}</div>
        )}
        {drawn.has('description') && entry.description && (
          <p className="mt-1.5 text-sm text-text-secondary leading-relaxed max-w-[72ch] whitespace-pre-line">
            {entry.description}
          </p>
        )}
      </div>
      {isOwner && (
        <div className="flex-none flex items-start gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button type="button" {...gripProps}
                  className="p-1.5 rounded-lg text-text-muted hover:bg-surface-2 hover:text-text-primary cursor-grab touch-none">
            <GripVerticalIcon className="w-4 h-4" />
          </button>
          <button type="button" onClick={onEdit} aria-label={`Edit ${title}`}
                  className="p-1.5 rounded-lg text-text-muted hover:bg-surface-2 hover:text-text-primary">
            <PencilIcon className="w-4 h-4" />
          </button>
          <button type="button" onClick={onRemove} aria-label={`Remove ${title}`}
                  className="p-1.5 rounded-lg text-text-muted hover:bg-surface-2 hover:text-red-600">
            <Trash2Icon className="w-4 h-4" />
          </button>
        </div>
      )}
    </li>
  );
}
