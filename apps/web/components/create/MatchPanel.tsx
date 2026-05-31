'use client';

import type { ReactNode } from 'react';
import type { NodeSearchResult } from '@/hooks/useNodeSearch';

const DEFAULT_FALLBACK_ICON = (
  <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
  </svg>
);

export default function MatchPanel({
  results,
  loading,
  onSelect,
  title,
  emptyHint,
  fallbackIcon = DEFAULT_FALLBACK_ICON,
}: {
  results: NodeSearchResult[];
  loading: boolean;
  onSelect: (result: NodeSearchResult) => void;
  title: string;
  emptyHint: string;
  fallbackIcon?: ReactNode;
}) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider px-1 mb-2">
        {title}
      </h3>

      {loading && (
        <div className="flex items-center gap-2 px-2 py-3 text-sm text-text-muted">
          <span className="w-4 h-4 border-2 border-text-muted/30 border-t-text-muted rounded-full animate-spin" />
          Searching...
        </div>
      )}

      {!loading && results.length === 0 && (
        <p className="text-xs text-text-muted px-1 py-3">
          {emptyHint}
        </p>
      )}

      <div className="flex flex-col gap-1 overflow-y-auto max-h-[340px] pr-1">
        {results.map((r) => {
          const email = r.metadata?.email as string | undefined;
          return (
            <button
              key={`${r.id}-${r.community_id}`}
              type="button"
              onClick={() => onSelect(r)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors hover:bg-surface-2 group"
            >
              {/* Avatar */}
              <div className="w-9 h-9 rounded-lg flex-shrink-0 overflow-hidden bg-surface-2 border border-border-default flex items-center justify-center">
                {r.image_url ? (
                  <img src={r.image_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  fallbackIcon
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">{r.name}</p>
                {r.subtitle && (
                  <p className="text-xs text-text-muted truncate">{r.subtitle}</p>
                )}
                <div className="flex items-center gap-2 mt-0.5">
                  {email && (
                    <span className="text-[11px] text-text-muted truncate">{email}</span>
                  )}
                  {r.community_name && (
                    <span className="text-[10px] text-text-muted bg-surface-2 px-1.5 py-0.5 rounded-full truncate">
                      {r.community_name}
                    </span>
                  )}
                </div>
              </div>

              {/* Arrow */}
              <svg className="w-4 h-4 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          );
        })}
      </div>
    </div>
  );
}
