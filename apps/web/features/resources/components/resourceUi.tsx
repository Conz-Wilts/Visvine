'use client';

/**
 * Presentation helpers for a file by its older `fileType` bucket, drawn with
 * the shared tile (`@visvine/ui` FileTypeIcon) so a PDF is the same red
 * square in a message, a list, the space page and the viewer.
 */

import { FileTypeIcon as Tile } from '@visvine/ui';
import { kindOf } from '@/lib/resources/shared/kinds';

export const FILE_BADGE: Record<string, string> = {
  pdf:      'bg-file-pdf-wash text-file-pdf-fg border-line-subtle',
  xlsx:     'bg-file-sheet-wash text-file-sheet-fg border-line-subtle',
  csv:      'bg-file-sheet-wash text-file-sheet-fg border-line-subtle',
  docx:     'bg-file-doc-wash text-file-doc-fg border-line-subtle',
  image:    'bg-file-image-wash text-file-image-fg border-line-subtle',
  markdown: 'bg-file-text-wash text-file-text-fg border-line-subtle',
  json:     'bg-file-code-wash text-file-code-fg border-line-subtle',
  text:     'bg-file-text-wash text-file-text-fg border-line-subtle',
};

export const FILE_LABEL: Record<string, string> = {
  pdf: 'PDF', xlsx: 'Spreadsheet', csv: 'CSV', docx: 'Document', image: 'Image',
  markdown: 'Markdown', json: 'JSON', text: 'Text',
};

/**
 * What a Drive file's RAG state looks like on a card.
 *
 * `unsupported` is deliberately neutral rather than a warning — an image having
 * no text to index is the expected outcome, not a problem to fix — while
 * `failed` is actionable and says so.
 */
export const INDEX_STATE_LABEL: Record<string, { label: string; className: string }> = {
  pending:     { label: 'Indexing…',   className: 'bg-warning-wash text-warning border-warning-line' },
  indexed:     { label: 'Searchable',  className: 'bg-success-wash text-success border-success-line' },
  unsupported: { label: 'Stored only', className: 'bg-surface-subtle text-fg-subtle border-line-subtle' },
  failed:      { label: 'Not indexed', className: 'bg-danger-wash text-danger-strong border-danger-line' },
};

/** The kind a `fileType` bucket (or a bare extension) belongs to. */
function kindOfFileType(type: string): string {
  if (type === 'image') return 'image';
  if (type === 'markdown') return 'text';
  return kindOf(`file.${type}`);
}

export function FileTypeIcon({
  type,
  kind,
  size = 'md',
}: {
  type: string;
  /** The resource's kind, when known; `type` is read otherwise. */
  kind?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  return <Tile kind={kind ?? kindOfFileType(type)} size={size} />;
}
