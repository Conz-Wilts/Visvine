'use client';

/**
 * Shared resource-file presentation helpers — file-type colors/icons, size
 * formatting, pin persistence, and the DOCX preview pane. Used by the
 * resources library grid, the detail drawer, the resource detail page, and
 * the space page's resources preview.
 */

import { useState, useEffect } from 'react';

export const FILE_BG: Record<string, string> = {
  pdf:      'bg-red-100 text-red-600',
  xlsx:     'bg-green-100 text-green-600',
  csv:      'bg-emerald-100 text-emerald-600',
  docx:     'bg-blue-100 text-blue-600',
  image:    'bg-purple-100 text-purple-600',
  markdown: 'bg-slate-100 text-slate-600',
  json:     'bg-amber-100 text-amber-600',
  text:     'bg-slate-100 text-slate-600',
};

export const FILE_BADGE: Record<string, string> = {
  pdf:      'bg-red-50 text-red-700 border-red-200',
  xlsx:     'bg-green-50 text-green-700 border-green-200',
  csv:      'bg-emerald-50 text-emerald-700 border-emerald-200',
  docx:     'bg-blue-50 text-blue-700 border-blue-200',
  image:    'bg-purple-50 text-purple-700 border-purple-200',
  markdown: 'bg-slate-50 text-slate-700 border-slate-200',
  json:     'bg-amber-50 text-amber-700 border-amber-200',
  text:     'bg-slate-50 text-slate-700 border-slate-200',
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
  pending:     { label: 'Indexing…',   className: 'bg-amber-50 text-amber-700 border-amber-200' },
  indexed:     { label: 'Searchable',  className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  unsupported: { label: 'Stored only', className: 'bg-surface-2 text-text-tertiary border-border-subtle' },
  failed:      { label: 'Not indexed', className: 'bg-red-50 text-red-700 border-red-200' },
};

/** Shown where a viewer would go when the file has no reachable object — a
 *  pre-migration row whose stored link expired, or storage being unconfigured. */
export function FileUnavailable() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-sm font-medium text-text-primary">This file isn&apos;t available to preview</p>
      <p className="text-xs text-text-tertiary">
        Its stored link has expired. Re-upload the file to restore it.
      </p>
    </div>
  );
}

export function FileTypeIcon({ type, className = '' }: { type: string; className?: string }) {
  const colors = FILE_BG[type] ?? 'bg-gray-100 text-gray-500';
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

// ─── Pin persistence (localStorage) ──────────────────────────────────────────

const PINNED_KEY = 'nb_pinned_resources';

export function getPinned(): string[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(PINNED_KEY) ?? '[]'); } catch { return []; }
}

export function togglePin(id: string) {
  const list = getPinned();
  const next = list.includes(id) ? list.filter(x => x !== id) : [...list, id];
  localStorage.setItem(PINNED_KEY, JSON.stringify(next));
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
    <div className="flex flex-1 items-center justify-center text-sm text-text-muted">
      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-green mr-3" />
      Loading preview…
    </div>
  );
  // The preview HTML is derived from an uploaded .docx — untrusted content. It is
  // rendered inside a sandboxed iframe (no `allow-scripts`), so any embedded
  // script or inline event handler is inert regardless of server-side scrubbing.
  // A minimal style block gives it readable typography without the app's CSS.
  const srcDoc = `<!doctype html><html><head><meta charset="utf-8">`
    + `<style>body{font:14px/1.6 system-ui,sans-serif;color:#111;margin:0;padding:24px}`
    + `img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:4px 8px}</style>`
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
