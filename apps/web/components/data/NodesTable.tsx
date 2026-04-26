'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import EditableDataTable, { ColumnConfig } from './EditableDataTable';
import type { NBNode, CommunityAlias, Community } from '@/lib/types';
import { slugify } from '@/lib/eventUtils';
import { getNodeTypes } from '@/lib/types';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { clearGraphCache } from '@/hooks/useCommunityGraphData';
import { useAuth } from '@/features/auth/contexts/AuthContext';
import { useCrmColumns } from '@/hooks/useCrmColumns';
import AddColumnModal, { CrmColumnType } from '@/components/crm/AddColumnModal';
import RequestUpgradePrompt from '@/components/crm/RequestUpgradePrompt';

interface NodesTableProps {
  communityId: string;
}

// Threshold: show upgrade prompt after this many private saves for one column
const UPGRADE_PROMPT_THRESHOLD = 3;

export default function NodesTable({ communityId }: NodesTableProps) {
  const [nodes, setNodes] = useState<NBNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddColumnModal, setShowAddColumnModal] = useState(false);
  // Pre-fill state for the upgrade flow (opening modal from upgrade prompt)
  const [modalDefaultName, setModalDefaultName] = useState<string | undefined>();
  const [modalDefaultType, setModalDefaultType] = useState<CrmColumnType | undefined>();

  // Tracks which private column IDs have already had the upgrade prompt dismissed
  const [dismissedPrompts, setDismissedPrompts] = useState<Set<string>>(new Set());
  // Which private column is currently surfacing an upgrade prompt
  const [upgradePromptColumnId, setUpgradePromptColumnId] = useState<string | null>(null);

  const { currentCommunity, refreshCommunity } = useCommunity();
  const { user } = useAuth();
  const isAuthenticated = !!user;

  const communityAliases = useMemo<CommunityAlias[]>(
    () => (currentCommunity?.communityAliases as CommunityAlias[]) ?? [],
    [currentCommunity]
  );

  const handleCreateAlias = async (alias: CommunityAlias) => {
    if (!currentCommunity) return;
    const nextAliases = [...communityAliases, alias];
    const res = await fetch('/api/data/communities', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        community: { ...currentCommunity, communityAliases: nextAliases } satisfies Community,
      }),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to save alias');
    await refreshCommunity();
  };

  const nodeIds = useMemo(() => nodes.map((n) => n.id), [nodes]);

  const {
    privateColumns,
    communityColumns,
    privateValueCounts,
    addPrivateColumn,
    removePrivateColumn,
    requestCommunityColumn,
    valueMap,
    columnsLoading: crmLoading,
  } = useCrmColumns({ communityId, nodeIds });

  // Get node types from community configuration
  const nodeTypes = useMemo(() => getNodeTypes(currentCommunity?.nodeTypes), [currentCommunity]);

  // Extract all unique tags from existing nodes for dropdown
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    nodes.forEach((node) => {
      if (Array.isArray(node.tags)) {
        node.tags.forEach((tag) => {
          if (tag && typeof tag === 'string') tagSet.add(tag);
        });
      }
    });
    return Array.from(tagSet).sort();
  }, [nodes]);

  // Standard columns
  const standardColumns: ColumnConfig[] = [
    { key: 'image_url', label: 'Image', type: 'image', width: 100, sortable: false, filterable: false },
    { key: 'type', label: 'Type', type: 'select', options: nodeTypes, required: true, width: 140, persistOnClear: true, typeAliases: communityAliases, onCreateAlias: handleCreateAlias, aliasFieldKey: 'alias' },
    { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Full name or title', width: 200 },
    { key: 'subtitle', label: 'Subtitle', type: 'text', placeholder: 'Role, tagline, etc.', width: 200 },
    { key: 'tags', label: 'Tags', type: 'tags', options: allTags, placeholder: 'Select tags', width: 220, creatable: true },
    { key: 'id', label: 'ID', type: 'readonly', required: true, width: 180 },
    { key: 'url', label: 'URL', type: 'readonly', width: 140 },
    { key: 'location', label: 'Location', type: 'text', placeholder: 'City, country', width: 160 },
    { key: 'community_id', label: 'Community ID', type: 'readonly', width: 140, filterable: false },
  ];

  // Merge CRM column configs from private + community columns
  const crmColumnConfigs = useMemo<ColumnConfig[]>(() => [
    ...communityColumns.map((col) => ({
      key: `com__${col.columnKey}`,
      label: col.columnName,
      type: col.columnType as ColumnConfig['type'],
      options: col.options ?? undefined,
      width: 160,
    })),
    ...privateColumns.map((col) => ({
      key: `prv__${col.id}`,
      label: col.columnName,
      type: col.columnType as ColumnConfig['type'],
      options: col.options ?? undefined,
      width: 160,
    })),
  ], [communityColumns, privateColumns]);

  // Merge CRM values into nodes for display
  const enrichedNodes = useMemo(() => {
    return nodes.map((node) => {
      const extra = valueMap.values[node.id] || {};
      return { ...node, ...extra } as unknown as NBNode;
    });
  }, [nodes, valueMap.values]);

  // Check if an upgrade prompt should be shown for any private column
  const promptColumn = useMemo(() => {
    if (!isAuthenticated) return null;
    for (const col of privateColumns) {
      const count = privateValueCounts[col.id] || 0;
      if (count >= UPGRADE_PROMPT_THRESHOLD && !dismissedPrompts.has(col.id)) {
        return col;
      }
    }
    return null;
  }, [privateColumns, privateValueCounts, dismissedPrompts, isAuthenticated]);

  useEffect(() => {
    if (promptColumn && upgradePromptColumnId !== promptColumn.id) {
      setUpgradePromptColumnId(promptColumn.id);
    }
  }, [promptColumn, upgradePromptColumnId]);

  const fetchNodes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/data/nodes?community_id=${communityId}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to fetch nodes');
      setNodes(data.nodes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch nodes');
    } finally {
      setLoading(false);
    }
  }, [communityId]);

  useEffect(() => {
    fetchNodes();
  }, [fetchNodes]);

  // ── Column management ──────────────────────────────────────────────────────

  const handleAddPrivateColumn = async (name: string, type: CrmColumnType, options?: string[]) => {
    await addPrivateColumn(name, type, options);
  };

  const handleRequestCommunityColumn = async (
    name: string,
    type: CrmColumnType,
    description: string,
    options?: string[]
  ) => {
    await requestCommunityColumn(name, type, description, options);
  };

  const handleRemoveColumn = async (columnKey: string) => {
    // columnKey is the flat key like `prv__<id>` or `com__<key>`
    if (columnKey.startsWith('prv__')) {
      const columnId = columnKey.replace('prv__', '');
      await removePrivateColumn(columnId);
    }
    // Community columns can't be removed from the table — handled via admin panel
  };

  const handleRequestUpgradeFromPrompt = async () => {
    if (!upgradePromptColumnId) return;
    const col = privateColumns.find((c) => c.id === upgradePromptColumnId);
    if (!col) return;
    setModalDefaultName(col.columnName);
    setModalDefaultType(col.columnType as CrmColumnType);
    setShowAddColumnModal(true);
    setDismissedPrompts((prev) => new Set([...prev, upgradePromptColumnId]));
    setUpgradePromptColumnId(null);
  };

  const handleDismissUpgradePrompt = () => {
    if (upgradePromptColumnId) {
      setDismissedPrompts((prev) => new Set([...prev, upgradePromptColumnId]));
    }
    setUpgradePromptColumnId(null);
  };

  // ── Node CRUD ──────────────────────────────────────────────────────────────

  const generateNodeId = (type: string, name: string): string => {
    if (!type || !name) return '';
    return `${type.toLowerCase()}:${slugify(name)}`;
  };

  const ensureUniqueId = (baseId: string, existingNodes: NBNode[]): string => {
    const existingIds = new Set(existingNodes.map((n) => n.id));
    if (!existingIds.has(baseId)) return baseId;
    let suffix = 2;
    let id = baseId;
    while (existingIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix++;
    }
    return id;
  };

  const generateNodeUrl = (name: string): string => (name ? `/${slugify(name)}` : '');

  /** Strip CRM keys out of a row before sending to the nodes API */
  const stripCrmKeys = (node: Partial<NBNode>): Partial<NBNode> => {
    const clean = { ...node } as Record<string, unknown>;
    for (const col of crmColumnConfigs) {
      delete clean[col.key];
    }
    return clean as Partial<NBNode>;
  };

  const handleAdd = async (node: Partial<NBNode>) => {
    if (!node.id && node.type && node.name) {
      node.id = ensureUniqueId(generateNodeId(node.type, node.name), nodes);
    }
    if (!node.url && node.name) node.url = generateNodeUrl(node.name);

    const processedNode = stripCrmKeys(node);
    processedNode.metadata = processedNode.metadata || {};
    // Legacy metadata columns (keys starting with `metadata.`)
    for (const col of crmColumnConfigs.filter((c) => c.key.startsWith('metadata.'))) {
      const metaKey = col.key.split('.')[1];
      if ((node as Record<string, unknown>)[col.key] !== undefined) {
        processedNode.metadata![metaKey] = (node as Record<string, unknown>)[col.key];
      }
    }

    const res = await fetch('/api/data/nodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node: processedNode, community_id: communityId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create node');

    clearGraphCache(communityId);
    await fetchNodes();
  };

  const handleUpdate = async (node: NBNode, originalNode: NBNode) => {
    if ((node.name !== originalNode.name || node.type !== originalNode.type) && node.type && node.name) {
      const baseId = generateNodeId(node.type, node.name);
      if (baseId !== node.id) {
        node.id = ensureUniqueId(baseId, nodes.filter((n) => n.id !== originalNode.id));
      }
    }
    if (node.name !== originalNode.name && node.name && !node.url) {
      node.url = generateNodeUrl(node.name);
    }

    const processedNode = stripCrmKeys(node) as NBNode;
    processedNode.metadata = processedNode.metadata || {};

    const res = await fetch('/api/data/nodes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node: processedNode, community_id: communityId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update node');

    clearGraphCache(communityId);
    await fetchNodes();
  };

  const handleDelete = async (node: NBNode) => {
    const res = await fetch(
      `/api/data/nodes?id=${encodeURIComponent(node.id)}&community_id=${communityId}`,
      { method: 'DELETE' }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete node');
    clearGraphCache(communityId);
  };

  const createEmptyRow = (): Partial<NBNode> => ({
    type: 'Person',
    name: '',
    subtitle: '',
    location: '',
    tags: [],
    community_id: communityId,
    id: '',
    url: '',
  });

  const validateRow = (node: Partial<NBNode>): string | null => {
    if (!node.type) return 'Type is required';
    if (!node.name) return 'Name is required';
    return null;
  };

  const handleNewRowChange = (row: Partial<NBNode>, columnKey: string): Partial<NBNode> => {
    if (columnKey === 'name' || columnKey === 'type') {
      if (row.type && row.name) row.id = ensureUniqueId(generateNodeId(row.type, row.name), nodes);
      if (row.name) row.url = generateNodeUrl(row.name);
    }
    return row;
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading || crmLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-600">Loading nodes…</div>
      </div>
    );
  }

  if (error && nodes.length === 0) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-md">
        <p className="text-red-700">{error}</p>
        <button onClick={fetchNodes} className="mt-2 text-sm text-red-600 hover:text-red-800 underline">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Upgrade prompt banner */}
      {promptColumn && upgradePromptColumnId && !dismissedPrompts.has(upgradePromptColumnId) && (
        <RequestUpgradePrompt
          columnName={promptColumn.columnName}
          filledCount={privateValueCounts[promptColumn.id] || 0}
          onRequest={handleRequestUpgradeFromPrompt}
          onDismiss={handleDismissUpgradePrompt}
        />
      )}

      {/* Add Column Modal */}
      <AddColumnModal
        isOpen={showAddColumnModal}
        onClose={() => {
          setShowAddColumnModal(false);
          setModalDefaultName(undefined);
          setModalDefaultType(undefined);
        }}
        onAddPrivate={handleAddPrivateColumn}
        onRequestCommunity={handleRequestCommunityColumn}
        isAuthenticated={isAuthenticated}
        defaultName={modalDefaultName}
        defaultType={modalDefaultType}
      />

      {/* Table */}
      <EditableDataTable
        columns={standardColumns}
        data={enrichedNodes as unknown as Record<string, unknown>[]}
        onAdd={handleAdd as unknown as (row: Partial<Record<string, unknown>>) => Promise<void>}
        onUpdate={handleUpdate as unknown as (row: Record<string, unknown>, originalRow: Record<string, unknown>) => Promise<void>}
        onDelete={handleDelete as unknown as (row: Record<string, unknown>) => Promise<void>}
        getRowKey={(node) => (node as unknown as NBNode).id}
        createEmptyRow={createEmptyRow}
        validateRow={validateRow}
        customColumns={crmColumnConfigs}
        onAddColumnModal={() => setShowAddColumnModal(true)}
        onRemoveColumn={handleRemoveColumn}
        onNewRowChange={handleNewRowChange}
        tableId={`nodes_${communityId}`}
      />
    </div>
  );
}
