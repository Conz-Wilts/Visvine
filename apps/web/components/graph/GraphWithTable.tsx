'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { GraphData, NBNode, NodeTypeConfig, CommunityAlias } from '@/lib/types';
import GraphDataTables from './GraphDataTables';
import NodeDetailsSidebar from './NodeDetailsSidebar';
import { OBSIDIAN_PHYSICS } from './utils/constants';
import { fetchNodeProfile } from '@/hooks/useNodeProfile';
import { prefetchProfile } from '@/hooks/useProfile';
import { type SimNode, type SimLink } from './CustomForceGraph';

// d3-force + the canvas renderer add ~120KB to the bundle and are only used
// on the 'graph' tab. Defer until that tab mounts.
const CustomForceGraph = dynamic(() => import('./CustomForceGraph'), {
  ssr: false,
  loading: () => <div className="flex h-full w-full items-center justify-center text-sm text-text-muted">Loading graph…</div>,
});

/* ============================================================================
   TYPE DEFINITIONS
   ============================================================================ */

interface GraphWithTableProps {
  activeTab: 'graph' | 'data';
  dataOverride?: GraphData;
  loadingOverride?: boolean;
  errorOverride?: string | null;
  focusNodeId?: string | null;
  dimmedNodeIds?: Set<string>;
  savedPositionsRef?: React.MutableRefObject<Map<string, { x: number; y: number }>>;
  graphDataHashRef?: React.MutableRefObject<string>;
  nodeTypes?: NodeTypeConfig[];
  communityAliases?: CommunityAlias[];
}

// Re-export types for consumers that import from this file
export type { SimNode, SimLink };

/* ============================================================================
   MAIN WRAPPER COMPONENT
   ============================================================================ */

const GraphWithTable: React.FC<GraphWithTableProps> = ({
  activeTab,
  dataOverride,
  loadingOverride,
  errorOverride,
  focusNodeId,
  dimmedNodeIds,
  savedPositionsRef: savedPositionsRefProp,
  graphDataHashRef: graphDataHashRefProp,
  nodeTypes,
  communityAliases
}) => {
  const [selectedNode, setSelectedNode] = useState<NBNode | null>(null);

  // Persistent storage for node positions across renders
  const localSavedPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const localGraphDataHashRef = useRef<string>('');
  const savedPositionsRef = savedPositionsRefProp || localSavedPositionsRef;
  const graphDataHashRef = graphDataHashRefProp || localGraphDataHashRef;

  // Handle node clicks - just set the node directly, sidebar handles the transition
  const handleNodeClick = useCallback((node: NBNode) => {
    if (selectedNode?.id === node.id) {
      setSelectedNode(null);
    } else {
      setSelectedNode(node);
    }
  }, [selectedNode]);

  // Prefetch profile data on hover so it's ready before the user clicks
  const hoveredNodeIdRef = useRef<string | null>(null);
  const handleNodeHover = useCallback((node: NBNode | null) => {
    const id = node?.id ?? null;
    if (id === hoveredNodeIdRef.current) return;
    hoveredNodeIdRef.current = id;
    if (!id) return;
    fetchNodeProfile(id);
    if (id.startsWith('person:')) prefetchProfile(id);
  }, []);

  const loading = loadingOverride ?? false;
  const error = errorOverride ?? null;
  const graphData = useMemo<GraphData>(
    () => dataOverride ?? { nodes: [], links: [] },
    [dataOverride]
  );

  // Create a hash of the graph structure to detect when it actually changes
  const graphDataHash = useMemo(() => {
    const nodeIds = graphData.nodes.map(n => n.id).sort().join(',');
    const linkIds = graphData.links.map(l => `${l.source}-${l.target}`).sort().join(',');
    return `${nodeIds}::${linkIds}`;
  }, [graphData.nodes, graphData.links]);

  const simLinks = useMemo<SimLink[]>(() => {
    const nodeIdSet = new Set(graphData.nodes.map(n => String(n.id)));
    const seen = new Set<string>();
    return graphData.links
      .filter(link => {
        if (!nodeIdSet.has(String(link.source)) || !nodeIdSet.has(String(link.target))) return false;
        const a = String(link.source);
        const b = String(link.target);
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(link => ({ ...link, source: String(link.source), target: String(link.target) }));
  }, [graphData.links, graphData.nodes]);

  // Obsidian-style seed: tight central scatter so nodes "burst" outward as
  // the simulation runs. Saved positions still take precedence for stable layouts.
  const simNodes = useMemo<SimNode[]>(() => {
    const structureChanged = graphDataHash !== graphDataHashRef.current;
    if (structureChanged) {
      graphDataHashRef.current = graphDataHash;
      savedPositionsRef.current.clear();
    }

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return graphData.nodes.map((node, index) => {
      const savedPos = savedPositionsRef.current.get(node.id);
      if (savedPos) {
        return { ...node, x: savedPos.x, y: savedPos.y, spawnTime: now, spawnIndex: index };
      }
      const angle = Math.random() * 2 * Math.PI;
      const r = Math.random() * OBSIDIAN_PHYSICS.seedRadius;
      return {
        ...node,
        x: r * Math.cos(angle),
        y: r * Math.sin(angle),
        spawnTime: now,
        spawnIndex: index,
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphData.nodes, graphDataHash]);

  // Loading state
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full gap-4 bg-brand-bg">
        <div className="relative w-16 h-16">
          <div className="absolute inset-0 rounded-full border-4 border-surface-3" />
          <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-brand-green animate-spin" />
        </div>
        <p className="text-sm text-text-muted font-medium">Loading graph…</p>
      </div>
    );
  }

  // Empty state
  if (!error && graphData.nodes.length === 0) {
    return activeTab === 'graph'
      ? <div className="flex items-center justify-center h-64 text-gray-600">No graph data matches the current filters.</div>
      : <GraphDataTables graphData={graphData} error={error} />;
  }

  // Graph view
  if (activeTab === 'graph') {
    return (
      <div className="relative h-full w-full bg-brand-bg">
        {error && (
          <div className="absolute top-4 left-1/2 z-10 -translate-x-1/2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-red-700">
            {error}
          </div>
        )}
        <div className="h-full w-full">
          <CustomForceGraph
            nodes={simNodes}
            links={simLinks}
            // Click-selection drives focus highlight too; falls back to the external
            // focus prop (search/url) when nothing is clicked.
            focusNodeId={selectedNode?.id ?? focusNodeId ?? null}
            dimmedNodeIds={dimmedNodeIds}
            // Only auto-zoom for external focus, not on every click.
            autoZoomToFocus={selectedNode == null && focusNodeId != null}
            onNodeClick={handleNodeClick}
            onNodeHover={handleNodeHover}
            savedPositionsRef={savedPositionsRef}
            nodeTypes={nodeTypes}
            communityAliases={communityAliases}
            onRerunLayout={() => {
              savedPositionsRef.current.clear();
              graphDataHashRef.current = '';
            }}
          />
        </div>
        <NodeDetailsSidebar
          node={selectedNode}
          allLinks={graphData.links}
          allNodes={graphData.nodes}
          onClose={() => setSelectedNode(null)}
        />
      </div>
    );
  }

  // Data table view
  return <GraphDataTables graphData={graphData} error={error} />;
};

export default GraphWithTable;
