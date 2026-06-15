'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDebounce } from '@/hooks/useDebounce';
import { getLinkTypes, type LinkTypeConfig } from '@/lib/types';
import { normalizeRelationship } from '@/lib/graph/relationships';

interface SearchResult {
  id: string;
  name: string;
  subtitle: string | null;
  community_id: string | null;
}

interface ConnectMenuProps {
  /** The node that was right-clicked — the link's source. */
  source: { id: string; name: string };
  communityId: string;
  linkTypes?: LinkTypeConfig[];
  /** Cursor position (viewport CSS px) to anchor the floating panel at. */
  anchor: { x: number; y: number };
  onClose: () => void;
  onViewProfile: () => void;
  /** Create the link. Returns a promise so the menu can show a pending state. */
  onCreate: (targetId: string, relationship: string) => Promise<void>;
}

const LAST_TYPE_KEY = 'vv_last_link_type';
const PANEL_W = 300;
const PANEL_H = 400;

/**
 * Right-click "Connect to…" menu for a graph node. Search any node in the
 * community (excluding the source), pick a relationship type from the
 * community's configured link types, and create the edge — all from one floating
 * panel anchored at the cursor. Admin-gated by the caller.
 */
export default function ConnectMenu({
  source,
  communityId,
  linkTypes,
  anchor,
  onClose,
  onViewProfile,
  onCreate,
}: ConnectMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [target, setTarget] = useState<SearchResult | null>(null);
  const [creating, setCreating] = useState(false);

  const types = getLinkTypes(linkTypes);
  const [relationship, setRelationship] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const last = localStorage.getItem(LAST_TYPE_KEY);
      if (last && types.some((t) => normalizeRelationship(t.name) === last)) return last;
    }
    return normalizeRelationship(types[0]?.name ?? 'related');
  });

  const debouncedQuery = useDebounce(query.trim(), 250);

  // Search any node kind, scoped to this community, excluding the source node.
  useEffect(() => {
    if (target) return; // already picked
    if (debouncedQuery.length < 2) { setResults([]); return; }
    const ctrl = new AbortController();
    setSearching(true);
    const params = new URLSearchParams({
      q: debouncedQuery,
      type: 'any',
      community_id: communityId,
      exclude_ids: source.id,
    });
    fetch(`/api/nodes/search?${params}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : { results: [] }))
      .then((d) => setResults(d.results ?? []))
      .catch(() => {})
      .finally(() => setSearching(false));
    return () => ctrl.abort();
  }, [debouncedQuery, communityId, source.id, target]);

  // Close on outside click + Escape.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const create = useCallback(async () => {
    if (!target || creating) return;
    setCreating(true);
    try {
      if (typeof window !== 'undefined') localStorage.setItem(LAST_TYPE_KEY, relationship);
      await onCreate(target.id, relationship);
      onClose();
    } finally {
      setCreating(false);
    }
  }, [target, relationship, creating, onCreate, onClose]);

  // Clamp the panel into the viewport.
  const left = typeof window !== 'undefined' ? Math.min(anchor.x, window.innerWidth - PANEL_W - 8) : anchor.x;
  const top = typeof window !== 'undefined' ? Math.min(anchor.y, window.innerHeight - PANEL_H - 8) : anchor.y;

  return (
    <div
      ref={panelRef}
      role="menu"
      className="fixed z-50 w-[300px] rounded-2xl border border-border-subtle bg-surface-1 shadow-xl overflow-hidden"
      style={{ left: Math.max(8, left), top: Math.max(8, top) }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-3 py-2 border-b border-border-subtle">
        <p className="text-[11px] uppercase tracking-wide text-text-muted">Connect</p>
        <p className="text-sm font-semibold text-text-primary truncate">{source.name}</p>
      </div>

      {!target ? (
        <div className="p-2">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Connect to… (search a node)"
            className="w-full px-3 py-2 rounded-lg border border-border-default bg-surface-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-green/40 focus:border-brand-green"
          />
          <div className="mt-1.5 max-h-56 overflow-y-auto">
            {searching && results.length === 0 && (
              <p className="px-3 py-2 text-xs text-text-muted">Searching…</p>
            )}
            {!searching && debouncedQuery.length >= 2 && results.length === 0 && (
              <p className="px-3 py-2 text-xs text-text-muted">No matching nodes.</p>
            )}
            {results.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setTarget(r)}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-surface-3 transition-colors"
              >
                <span className="block text-sm text-text-primary truncate">{r.name}</span>
                {r.subtitle && <span className="block text-xs text-text-muted truncate">{r.subtitle}</span>}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="p-3 space-y-3">
          <div className="text-sm text-text-primary">
            <span className="text-text-muted">to </span>
            <span className="font-semibold">{target.name}</span>
          </div>
          <label className="block text-xs text-text-muted">
            Relationship
            <select
              value={relationship}
              onChange={(e) => setRelationship(e.target.value)}
              className="mt-1 w-full px-2.5 py-2 rounded-lg border border-border-default bg-surface-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-green/40"
            >
              {types.map((t) => (
                <option key={t.name} value={normalizeRelationship(t.name)}>
                  {t.name}{t.directed ? ' →' : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { setTarget(null); setResults([]); }}
              className="px-2.5 py-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-3 text-sm transition-colors"
            >
              Back
            </button>
            <button
              type="button"
              onClick={create}
              disabled={creating}
              className="flex-1 px-3 py-2 rounded-lg bg-brand-green text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {creating ? 'Linking…' : 'Create link'}
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => { onViewProfile(); onClose(); }}
        className="w-full text-left px-3 py-2 border-t border-border-subtle text-sm text-text-secondary hover:bg-surface-3 hover:text-text-primary transition-colors"
      >
        View profile
      </button>
    </div>
  );
}
