'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSession } from '@/lib/auth-client';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CrmColumnType = 'text' | 'date' | 'select' | 'tags' | 'url';

export interface PrivateColumn {
  id: string;
  columnKey: string;
  columnName: string;
  columnType: string;
  options: string[] | null;
  position: number;
}

export interface CommunityColumn {
  id: string;
  columnKey: string;
  columnName: string;
  columnType: string;
  options: string[] | null;
  position: number;
}

export interface PendingRequest {
  id: string;
  columnKey: string;
  columnName: string;
  columnType: string;
  status: 'pending' | 'approved' | 'rejected';
}

// ─── Key helpers (flat keys used as row property names) ───────────────────────
export const prvKey = (columnId: string) => `prv__${columnId}`;
export const comKey = (columnKey: string) => `com__${columnKey}`;

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface UseCrmColumnsOptions {
  communityId: string | null | undefined;
  nodeIds: string[];
}

export interface CrmValueMap {
  /** { [nodeId]: { [flatKey]: value } } */
  values: Record<string, Record<string, string | null>>;
  /** { [nodeId]: { [columnKey]: contributor } } */
  contributors: Record<string, Record<string, { name: string; image: string | null } | null>>;
}

export function useCrmColumns({ communityId, nodeIds }: UseCrmColumnsOptions) {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;

  const [privateColumns, setPrivateColumns] = useState<PrivateColumn[]>([]);
  const [communityColumns, setCommunityColumns] = useState<CommunityColumn[]>([]);
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [valueMap, setValueMap] = useState<CrmValueMap>({ values: {}, contributors: {} });
  const [columnsLoading, setColumnsLoading] = useState(false);

  // Derived (not stored) so it always reflects the currently-loaded window: the
  // value cache is evicted as you scroll, and accumulating a separate counter
  // would double-count rows that get evicted and later re-loaded.
  const privateValueCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const cols of Object.values(valueMap.values)) {
      for (const [key, value] of Object.entries(cols)) {
        if (value && key.startsWith('prv__')) {
          const columnId = key.slice('prv__'.length);
          counts[columnId] = (counts[columnId] || 0) + 1;
        }
      }
    }
    return counts;
  }, [valueMap]);

  // ── Load column definitions ────────────────────────────────────────────────

  const loadColumns = useCallback(async () => {
    if (!communityId) return;
    setColumnsLoading(true);

    const fetches: Promise<void>[] = [];

    fetches.push(
      fetch(`/api/crm/community-columns?community_id=${communityId}`)
        .then(r => r.json())
        .then(d => setCommunityColumns(d.columns || []))
        .catch(() => {})
    );

    if (isAuthenticated) {
      fetches.push(
        fetch('/api/crm/private-columns')
          .then(r => r.json())
          .then(d => setPrivateColumns(d.columns || []))
          .catch(() => {})
      );
      fetches.push(
        fetch(`/api/crm/column-requests?community_id=${communityId}`)
          .then(r => r.json())
          .then(d => setPendingRequests((d.requests || []).filter((r: PendingRequest) => r.status === 'pending')))
          .catch(() => {})
      );
    }

    await Promise.all(fetches);
    setColumnsLoading(false);
  }, [communityId, isAuthenticated]);

  // ── Load values ────────────────────────────────────────────────────────────

  const loadValues = useCallback(async (ids: string[], signal?: AbortSignal): Promise<boolean> => {
    if (!communityId || ids.length === 0) return true;

    // Track whether any request genuinely failed (vs. was aborted). The caller
    // only records ids as loaded on a clean success, so real failures retry on
    // the next change while aborts are silently ignored.
    let failed = false;
    const onErr = (err: unknown) => {
      if ((err as { name?: string })?.name !== 'AbortError') failed = true;
    };

    const fetches: Promise<void>[] = [];

    // Community values (public). POST so the id list rides in the body — a GET
    // with one node_ids[] param per node overflows URL/header limits at scale.
    fetches.push(
      fetch('/api/crm/community-values', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ community_id: communityId, node_ids: ids }),
        signal,
      })
        .then(r => r.json())
        .then(d => {
          const raw: Record<string, Record<string, { value: string | null; contributedBy: { id: string; name: string; image: string | null } | null }>> = d.values || {};
          setValueMap(prev => {
            const nextValues = { ...prev.values };
            const nextContributors = { ...prev.contributors };
            // Clone each touched node's maps (don't mutate in place) so row
            // memoization can detect the change by per-node object identity.
            for (const [nodeId, cols] of Object.entries(raw)) {
              const mergedValues = { ...(nextValues[nodeId] || {}) };
              const mergedContributors = { ...(nextContributors[nodeId] || {}) };
              for (const [colKey, entry] of Object.entries(cols)) {
                mergedValues[comKey(colKey)] = entry.value;
                mergedContributors[colKey] = entry.contributedBy;
              }
              nextValues[nodeId] = mergedValues;
              nextContributors[nodeId] = mergedContributors;
            }
            return { values: nextValues, contributors: nextContributors };
          });
        })
        .catch(onErr)
    );

    // Private values
    if (isAuthenticated) {
      fetches.push(
        fetch('/api/crm/private-values', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ node_ids: ids }),
          signal,
        })
          .then(r => r.json())
          .then(d => {
            const raw: Record<string, Record<string, string | null>> = d.values || {};
            setValueMap(prev => {
              const nextValues = { ...prev.values };
              for (const [nodeId, cols] of Object.entries(raw)) {
                const merged = { ...(nextValues[nodeId] || {}) };
                for (const [columnId, value] of Object.entries(cols)) {
                  merged[prvKey(columnId)] = value;
                }
                nextValues[nodeId] = merged;
              }
              return { ...prev, values: nextValues };
            });
          })
          .catch(onErr)
      );
    }

    await Promise.all(fetches);
    return !failed;
  }, [communityId, isAuthenticated]);

  useEffect(() => { loadColumns(); }, [loadColumns]);

  // Node ids whose values we've already fetched. Filtering / searching / sorting
  // the table feeds new id arrays that are subsets or reorders of what's already
  // loaded, so we only ever fetch the ids we haven't seen — those interactions
  // cost zero network/CPU after the first load.
  const loadedIdsRef = useRef<Set<string>>(new Set());

  // The value namespace is scoped per-community and per-auth-state; drop the
  // cache when either changes so the new context reloads from scratch.
  useEffect(() => {
    loadedIdsRef.current = new Set();
    setValueMap({ values: {}, contributors: {} });
  }, [communityId, isAuthenticated]);

  // `nodeIds` is the *window* of rows around the viewport (caller-supplied).
  // Load values for any window rows we don't have yet, and evict values for
  // rows that have scrolled out of the window — so memory stays bounded no
  // matter how far the user scrolls. Evicted rows re-fetch when scrolled back.
  useEffect(() => {
    const windowSet = new Set(nodeIds);
    const missing = nodeIds.filter(id => !loadedIdsRef.current.has(id));
    const stale = [...loadedIdsRef.current].filter(id => !windowSet.has(id));
    if (missing.length === 0 && stale.length === 0) return;
    const controller = new AbortController();
    // Debounce to scroll-settle: fast scrolling keeps clearing this timeout, so
    // we neither fetch nor evict per row, and we abort any in-flight load.
    const t = setTimeout(async () => {
      if (stale.length > 0) {
        for (const id of stale) loadedIdsRef.current.delete(id);
        // Rebuild keeping only window rows; kept rows retain their object
        // identity so mounted rows don't re-render on eviction.
        setValueMap(prev => {
          const values: CrmValueMap['values'] = {};
          const contributors: CrmValueMap['contributors'] = {};
          for (const id of windowSet) {
            if (prev.values[id]) values[id] = prev.values[id];
            if (prev.contributors[id]) contributors[id] = prev.contributors[id];
          }
          return { values, contributors };
        });
      }
      if (missing.length > 0) {
        const ok = await loadValues(missing, controller.signal);
        if (ok && !controller.signal.aborted) {
          for (const id of missing) loadedIdsRef.current.add(id);
        }
      }
    }, 200);
    return () => { clearTimeout(t); controller.abort(); };
  }, [nodeIds, loadValues]);

  // ── Mutations ──────────────────────────────────────────────────────────────

  const addPrivateColumn = useCallback(async (name: string, type: CrmColumnType, options?: string[]) => {
    const res = await fetch('/api/crm/private-columns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ community_id: communityId, column_name: name, column_type: type, options: options?.length ? options : undefined }),
    });
    if (!res.ok) throw new Error('Failed to create column');
    const { column } = await res.json();
    setPrivateColumns(prev => [...prev, column]);
    return column as PrivateColumn;
  }, [communityId]);

  const removePrivateColumn = useCallback(async (columnId: string) => {
    const res = await fetch(`/api/crm/private-columns?id=${columnId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete column');
    setPrivateColumns(prev => prev.filter(c => c.id !== columnId));
    setValueMap(prev => {
      const nextValues = { ...prev.values };
      const key = prvKey(columnId);
      for (const nodeId of Object.keys(nextValues)) {
        const { [key]: _removed, ...rest } = nextValues[nodeId] || {};
        nextValues[nodeId] = rest;
      }
      return { ...prev, values: nextValues };
    });
  }, []);

  const requestCommunityColumn = useCallback(async (name: string, type: CrmColumnType, description: string, options?: string[], fromPrivateColumnId?: string) => {
    const res = await fetch('/api/crm/column-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ community_id: communityId, column_name: name, column_type: type, description, options: options?.length ? options : undefined, from_private_column_id: fromPrivateColumnId }),
    });
    if (!res.ok) throw new Error('Failed to submit request');
    const { request } = await res.json();
    setPendingRequests(prev => [...prev, request]);
    return request;
  }, [communityId]);

  const savePrivateValue = useCallback(async (nodeId: string, columnId: string, value: string) => {
    const res = await fetch('/api/crm/private-values', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node_id: nodeId, column_id: columnId, value }),
    });
    if (!res.ok) throw new Error('Failed to save');
    // Optimistic update (privateValueCounts is derived from valueMap, so it
    // updates automatically).
    setValueMap(prev => ({
      ...prev,
      values: { ...prev.values, [nodeId]: { ...(prev.values[nodeId] || {}), [prvKey(columnId)]: value } },
    }));
  }, []);

  const saveCommunityValue = useCallback(async (nodeId: string, columnId: string, columnKey: string, value: string) => {
    const res = await fetch('/api/crm/community-values', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ community_id: communityId, node_id: nodeId, column_key: columnKey, column_id: columnId, value }),
    });
    if (!res.ok) throw new Error('Failed to save');
    setValueMap(prev => ({
      ...prev,
      values: { ...prev.values, [nodeId]: { ...(prev.values[nodeId] || {}), [comKey(columnKey)]: value } },
    }));
  }, [communityId]);

  const shareValueWithCommunity = useCallback(async (
    nodeId: string,
    columnKey: string,
    columnName: string,
    columnType: string,
    value: string,
    targetCommunityId: string,
  ) => {
    const res = await fetch('/api/crm/value-share-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        community_id: targetCommunityId,
        node_id: nodeId,
        column_key: columnKey,
        column_name: columnName,
        column_type: columnType,
        value,
      }),
    });
    if (!res.ok) throw new Error('Failed to submit share request');
    return res.json();
  }, []);

  return {
    isAuthenticated,
    columnsLoading,
    privateColumns,
    communityColumns,
    pendingRequests,
    valueMap,
    privateValueCounts,
    addPrivateColumn,
    removePrivateColumn,
    requestCommunityColumn,
    savePrivateValue,
    saveCommunityValue,
    shareValueWithCommunity,
    reloadColumns: loadColumns,
  };
}
