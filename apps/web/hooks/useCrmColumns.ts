'use client';

import { useState, useEffect, useCallback } from 'react';
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
  const [privateValueCounts, setPrivateValueCounts] = useState<Record<string, number>>({});

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

  const loadValues = useCallback(async (ids: string[]) => {
    if (!communityId || ids.length === 0) return;
    const qs = ids.map(id => `node_ids[]=${encodeURIComponent(id)}`).join('&');

    const fetches: Promise<void>[] = [];

    // Community values (public)
    fetches.push(
      fetch(`/api/crm/community-values?community_id=${communityId}&${qs}`)
        .then(r => r.json())
        .then(d => {
          const raw: Record<string, Record<string, { value: string | null; contributedBy: { id: string; name: string; image: string | null } | null }>> = d.values || {};
          setValueMap(prev => {
            const nextValues = { ...prev.values };
            const nextContributors = { ...prev.contributors };
            for (const [nodeId, cols] of Object.entries(raw)) {
              nextValues[nodeId] = nextValues[nodeId] || {};
              nextContributors[nodeId] = nextContributors[nodeId] || {};
              for (const [colKey, entry] of Object.entries(cols)) {
                nextValues[nodeId][comKey(colKey)] = entry.value;
                nextContributors[nodeId][colKey] = entry.contributedBy;
              }
            }
            return { values: nextValues, contributors: nextContributors };
          });
        })
        .catch(() => {})
    );

    // Private values
    if (isAuthenticated) {
      fetches.push(
        fetch(`/api/crm/private-values?${qs}`)
          .then(r => r.json())
          .then(d => {
            const raw: Record<string, Record<string, string | null>> = d.values || {};
            // Count filled values per column for upgrade prompt
            const counts: Record<string, number> = {};
            setValueMap(prev => {
              const nextValues = { ...prev.values };
              for (const [nodeId, cols] of Object.entries(raw)) {
                nextValues[nodeId] = nextValues[nodeId] || {};
                for (const [columnId, value] of Object.entries(cols)) {
                  nextValues[nodeId][prvKey(columnId)] = value;
                  if (value) counts[columnId] = (counts[columnId] || 0) + 1;
                }
              }
              return { ...prev, values: nextValues };
            });
            setPrivateValueCounts(counts);
          })
          .catch(() => {})
      );
    }

    await Promise.all(fetches);
  }, [communityId, isAuthenticated]);

  useEffect(() => { loadColumns(); }, [loadColumns]);

  useEffect(() => {
    if (nodeIds.length > 0) loadValues(nodeIds);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeIds.join(','), loadValues]);

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
    // Optimistic update
    setValueMap(prev => ({
      ...prev,
      values: { ...prev.values, [nodeId]: { ...(prev.values[nodeId] || {}), [prvKey(columnId)]: value } },
    }));
    setPrivateValueCounts(prev => ({ ...prev, [columnId]: (prev[columnId] || 0) + (value ? 1 : 0) }));
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
