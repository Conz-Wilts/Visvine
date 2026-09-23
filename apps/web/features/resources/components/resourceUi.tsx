'use client';

/**
 * Shared resource-file presentation helpers — file-type colors/icons, size
 * formatting, pin persistence, and the DOCX preview pane. Used by the
 * resources library grid, the detail drawer, the resource detail page, and
 * the space page's resources preview.
 */

import { useState, useEffect } from 'react';
import { color } from '@visvine/tokens';

const FILE_BG: Record<string, string> = {
  pdf:      'bg-hue-red-wash text-hue-red-fg',
  xlsx:     'bg-hue-green-wash text-hue-green-fg',
  csv:      'bg-hue-teal-wash text-hue-teal-fg',
  docx:     'bg-hue-blue-wash text-hue-blue-fg',
  image:    'bg-hue-violet-wash text-hue-violet-fg',
  markdown: 'bg-hue-gray-wash text-hue-gray-fg',
  json:     'bg-hue-amber-wash text-hue-amber-fg',
  text:     'bg-hue-gray-wash text-hue-gray-fg',
};

export const FILE_BADGE: Record<string, string> = {
  pdf:      'bg-hue-red-wash text-hue-red-fg border-hue-red-line',
  xlsx:     'bg-hue-green-wash text-hue-green-fg border-hue-green-line',
  csv:      'bg-hue-teal-wash text-hue-teal-fg border-hue-teal-line',
  docx:     'bg-hue-blue-wash text-hue-blue-fg border-hue-blue-line',
  image:    'bg-hue-violet-wash text-hue-violet-fg border-hue-violet-line',
  markdown: 'bg-hue-gray-wash text-hue-gray-fg border-hue-gray-line',
  json:     'bg-hue-amber-wash text-hue-amber-fg border-hue-amber-line',
  text:     'bg-hue-gray-wash text-hue-gray-fg border-hue-gray-line',
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

/** Shown where a viewer would go when the file has no reachable object — a
 *  pre-migration row whose stored link expired, or storage being unconfigured. */
export function FileUnavailable() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-sm font-medium text-fg">This file isn&apos;t available to preview</p>
      <p className="text-xs text-fg-subtle">
        Its stored link has expired. Re-upload the file to restore it.
      </p>
    </div>
  );
}

export function FileTypeIcon({ type, className = '' }: { type: string; className?: string }) {
  const colors = FILE_BG[type] ?? 'bg-surface-muted text-fg-muted';
  const iconClass = 'h-5 w-5';
  const content = type === 'image' ? (
    <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ) : type === 'pdf' ? (
    <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  ) : type === 'docx' ? (
    <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ) : (
    <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18M10 3v18M14 3v18M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" />
    </svg>
  );
  return (
    <div className={`flex items-center justify-center rounded-xl ${colors} ${className}`}>
      {content}
    </div>
  );
}

// ─── Docx viewer ─────────────────────────────────────────────────────────────

export function DocxViewer({ resourceId }: { resourceId: string }) {
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setHtml('');
    fetch(`/api/resources/${resourceId}/docx-preview`)
      .then(r => r.text())
      .then(h => { setHtml(h); setLoading(false); })
      .catch(() => setLoading(false));
  }, [resourceId]);

  if (loading) return (
    <div className="flex flex-1 items-center justify-center text-sm text-fg-muted">
      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent mr-3" />
      Loading preview…
    </div>
  );
  // The preview HTML is derived from an uploaded .docx — untrusted content. It is
  // rendered inside a sandboxed iframe (no `allow-scripts`), so any embedded
  // script or inline event handler is inert regardless of server-side scrubbing.
  // A minimal style block gives it readable typography without the app's CSS.
  const srcDoc = `<!doctype html><html><head><meta charset="utf-8">`
    + `<style>body{font:14px/1.6 system-ui,sans-serif;color:${color.fg.default};margin:0;padding:24px}`
    + `img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid ${color.line.default};padding:4px 8px}</style>`
    + `</head><body>${html}</body></html>`;
  return (
    <iframe
      title="Document preview"
      className="flex-1 w-full border-0"
      sandbox=""
      srcDoc={srcDoc}
    />
  );
}
