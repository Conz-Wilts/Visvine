import React from 'react';
import type { DirectoryItem } from '@/components/dashboard/types';
import { Badge } from '@/components/ui';

export interface ProfileColumn {
  key: keyof DirectoryItem;
  label: string;
}

const TYPE_COLUMNS: Record<string, ProfileColumn[]> = {
  person: [
    { key: 'subtitle', label: 'Role / Headline' },
    { key: 'location', label: 'Location' },
    { key: 'bio', label: 'About' },
    { key: 'tags', label: 'Skills' },
    { key: 'website', label: 'Website' },
    { key: 'linkedinUrl', label: 'LinkedIn' },
    { key: 'twitterUrl', label: 'Twitter' },
    { key: 'phone', label: 'Phone' },
    { key: 'pronouns', label: 'Pronouns' },
  ],
  organization: [
    { key: 'subtitle', label: 'Description' },
    { key: 'location', label: 'Location' },
    { key: 'url', label: 'Website' },
    { key: 'tags', label: 'Tags' },
  ],
  event: [
    { key: 'subtitle', label: 'Description' },
    { key: 'location', label: 'Location' },
    { key: 'tags', label: 'Tags' },
  ],
  group: [
    { key: 'subtitle', label: 'Description' },
    { key: 'location', label: 'Location' },
    { key: 'tags', label: 'Tags' },
  ],
  resource: [
    { key: 'subtitle', label: 'Description' },
    { key: 'url', label: 'URL' },
    { key: 'tags', label: 'Tags' },
  ],
};

const DEFAULT_COLUMNS: ProfileColumn[] = [
  { key: 'subtitle', label: 'Details' },
  { key: 'tags', label: 'Tags' },
];

export function getProfileColumns(activeType: string): ProfileColumn[] {
  return TYPE_COLUMNS[activeType.toLowerCase()] ?? DEFAULT_COLUMNS;
}

export function renderProfileCell(item: DirectoryItem, col: ProfileColumn): React.ReactNode {
  const value = item[col.key];
  if (col.key === 'tags') {
    const tags = item.tags;
    if (!tags || tags.length === 0) return <span className="text-text-muted">—</span>;
    return (
      <div className="flex flex-wrap gap-1.5">
        {tags.slice(0, 3).map(tag => (
          <Badge key={tag} variant="table-type" className="bg-surface-3 text-text-secondary border-transparent">{tag}</Badge>
        ))}
        {tags.length > 3 && <span className="text-xs text-text-muted">+{tags.length - 3}</span>}
      </div>
    );
  }
  if ((col.key === 'url' || col.key === 'website' || col.key === 'linkedinUrl' || col.key === 'twitterUrl') && value) {
    return (
      <a
        href={value as string}
        target="_blank"
        rel="noopener noreferrer"
        onClick={e => e.stopPropagation()}
        className="text-sm text-brand-green hover:underline truncate max-w-[160px] block"
      >
        {(value as string).replace(/^https?:\/\//, '')}
      </a>
    );
  }
  if (!value) return <span className="text-text-muted">—</span>;
  return <span className="text-sm text-text-primary truncate max-w-[200px] block">{value as string}</span>;
}
