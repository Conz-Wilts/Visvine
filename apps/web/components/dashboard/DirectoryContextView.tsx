'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ContextWithTable, { type ContextLayoutData } from '@/components/context/ContextWithTable';
import { useCommunityContextData } from '@/hooks/useCommunityContextData';
import { findBestMatchingNodeId } from '@/lib/contextUtils';
import { isStructuralNodeType } from '@/lib/types/context';
import type { CommunityAlias, ContextData } from '@/lib/types';

// The context unmounts whenever the user navigates away from /context, so keep
// the last known layout per community for the session. A remount then restores
// the frozen layout immediately instead of waiting on (or re-running) anything.
// Updated on every persist so it never lags behind the server copy.
const layoutCache = new Map<string, ContextLayoutData | null>();

interface DirectoryContextViewProps {
  /** Current value of the context search box (drives focus + dimming). */
  searchTerm: string;
  /** Fires with the search's best-matching node (null when search is empty),
   *  so the page can mirror the focus elsewhere (e.g. the notes sidebar). */
  onFocusNodeChange?: (node: { id: string; type: string } | null) => void;
}

/**
 * The community context — the body of the /context tool.
 *
 * It owns the heavy context data fetch (nodes + links) and the d3-force bundle, so
 * neither loads until the user actually opens the context. It also restores the
 * saved force-directed layout from the server instead of recomputing it.
 */
export default function DirectoryContextView({
  searchTerm,
  onFocusNodeChange,
}: DirectoryContextViewProps) {
  const { contextData: allData, loading, error, community } = useCommunityContextData();

  // Everything creatable is a node now — spaces, channels, notes, uploaded
  // files. That's what makes the graph complete, and also what would bury the
  // people in it, so structure is off until asked for. Links to hidden nodes
  // drop out downstream (ContextWithTable filters links to present endpoints).
  const [showStructure, setShowStructure] = useState(false);
  const contextData = useMemo<ContextData>(() => {
    if (showStructure) return allData;
    return { ...allData, nodes: allData.nodes.filter((n) => !isStructuralNodeType(n.type)) };
  }, [allData, showStructure]);
  const structuralCount = useMemo(
    () => allData.nodes.filter((n) => isStructuralNodeType(n.type)).length,
    [allData.nodes],
  );

  // ── Saved layout (per community) ───────────────────────────────────────────
  // undefined = still loading, null = none saved, object = restore it.
  const [layout, setLayout] = useState<ContextLayoutData | null | undefined>(() =>
    community?.id && layoutCache.has(community.id) ? layoutCache.get(community.id) : undefined
  );

  useEffect(() => {
    const id = community?.id;
    if (!id) return;
    if (layoutCache.has(id)) {
      setLayout(layoutCache.get(id));
      return;
    }
    let cancelled = false;
    setLayout(undefined);
    fetch(`/api/communities/${id}/context/layout`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled) return;
        const next = (d as ContextLayoutData | null) ?? null;
        layoutCache.set(id, next);
        setLayout(next);
      })
      .catch(() => { if (!cancelled) setLayout(null); });
    return () => { cancelled = true; };
  }, [community?.id]);

  // Fire-and-forget save. The canvas already debounces camera changes and only
  // emits on settle/drag, so a second debounce here would just add latency.
  const handlePersistLayout = useCallback((next: ContextLayoutData) => {
    const id = community?.id;
    if (!id) return;
    layoutCache.set(id, next);
    fetch(`/api/communities/${id}/context/layout`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    }).catch(() => {});
  }, [community?.id]);

  // ── Text search dims non-matching nodes (the full context stays visible) ──────
  const dimmedNodeIds = useMemo<Set<string>>(() => {
    const normalized = searchTerm.trim().toLowerCase();
    if (!normalized) return new Set();
    const ids = new Set<string>();
    contextData.nodes.forEach(node => {
      const matches =
        node.name.toLowerCase().includes(normalized) ||
        (node.subtitle || '').toLowerCase().includes(normalized) ||
        (node.location || '').toLowerCase().includes(normalized) ||
        (node.tags || []).some(t => t.toLowerCase().includes(normalized));
      if (!matches) ids.add(node.id);
    });
    return ids;
  }, [contextData, searchTerm]);

  const focusedNodeId = useMemo<string | null>(() => {
    const trimmed = searchTerm.trim();
    if (!trimmed) return null;
    return findBestMatchingNodeId(contextData.nodes, trimmed);
  }, [searchTerm, contextData.nodes]);

  useEffect(() => {
    if (!onFocusNodeChange) return;
    const node = focusedNodeId ? contextData.nodes.find(n => n.id === focusedNodeId) : null;
    onFocusNodeChange(node ? { id: node.id, type: node.type } : null);
  }, [focusedNodeId, contextData.nodes, onFocusNodeChange]);

  return (
    <>
      {structuralCount > 0 && (
        <button
          type="button"
          onClick={() => setShowStructure((v) => !v)}
          className={`absolute bottom-4 right-8 z-20 rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm transition-colors ${
            showStructure
              ? 'border-transparent bg-text-primary text-white'
              : 'border-border-subtle bg-surface-raised text-text-muted hover:text-text-primary'
          }`}
          aria-pressed={showStructure}
        >
          {showStructure ? 'Hide' : 'Show'} structure ({structuralCount})
        </button>
      )}
      <ContextWithTable
        dataOverride={contextData}
        loadingOverride={loading || layout === undefined}
        errorOverride={error}
        focusNodeId={focusedNodeId}
        dimmedNodeIds={dimmedNodeIds}
        nodeTypes={community?.nodeTypes}
        communityAliases={community?.communityAliases as CommunityAlias[] | undefined}
        initialLayout={layout ?? null}
        onPersistLayout={handlePersistLayout}
      />
    </>
  );
}
