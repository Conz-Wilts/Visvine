'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ContextWithTable, { type ContextLayoutData } from '@/components/context/ContextWithTable';
import { useCommunityContextData } from '@/hooks/useCommunityContextData';
import { findBestMatchingNodeId } from '@/lib/context/normalize';
import { buildFolderView, placeFolderView, typeRingLayout, pluralTypeLabel, folderTypeKey, aliasExpansionKey, isAliasNodeId } from '@/lib/context/folderView';
import { buildBrainView, brainTreeLayout, placeBrainView, isBrainFolderId, brainFolderPathOf, type BrainViewInput } from '@/lib/context/brainView';
import { entityKindOf, entityNotePath } from '@/lib/notes/entities';
import { ancestorFolders, humanizeFolderName } from '@/lib/notes/shared/indexNote';
import type { TreeNode, NoteMeta } from '@/lib/notes/shared/types';
import { notesApi } from '@/features/notes/lib/notesApi';
import { isStructuralNodeType, getNodeTypeConfig } from '@/lib/types/context';
import type { CommunityAlias, ContextData, NBNode } from '@/lib/types';

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
 * The default view is the folder map: one meta-node per entity type (People,
 * Events, …) with counts and aggregated, weighted edges between them. Clicking
 * a folder expands it in place — members spiral out where the folder stood —
 * and chips above the canvas collapse it again. Focus/hover/path highlighting
 * operates on whatever is visible.
 *
 * Layouts for this view are transition-derived and session-local: each
 * expand/collapse keeps every on-screen node where it was, so nothing is
 * fetched from or persisted to the server.
 */
export default function DirectoryContextView({
  searchTerm,
  onFocusNodeChange,
}: DirectoryContextViewProps) {
  const { contextData: allData, loading, error, community } = useCommunityContextData();

  // Everything creatable is a node now — spaces, channels, notes, uploaded
  // files. That's what makes the graph complete, and also what would bury the
  // people in it, so structural nodes stay out.
  const contextData = useMemo<ContextData>(
    () => ({ ...allData, nodes: allData.nodes.filter((n) => !isStructuralNodeType(n.type)) }),
    [allData],
  );

  // ── View mode ─────────────────────────────────────────────────────────────
  // 'folders' (default) mirrors the brain's index-folder tree as a radial tree
  // expanding outwards; 'types' groups entities by type on the force engine.
  const [viewMode, setViewMode] = useState<'folders' | 'types'>('folders');

  // The brain tree + note metas backing the Folders mode, fetched lazily and
  // kept for the session.
  const [brain, setBrain] = useState<{ communityId: string; tree: TreeNode; notes: NoteMeta[] } | null>(null);
  const brainLoadingRef = useRef(false);
  useEffect(() => {
    const communityId = community?.id;
    if (viewMode !== 'folders' || !communityId) return;
    if (brain?.communityId === communityId || brainLoadingRef.current) return;
    brainLoadingRef.current = true;
    Promise.all([notesApi.tree(communityId), notesApi.list(communityId)])
      .then(([{ tree }, { notes }]) => setBrain({ communityId, tree, notes }))
      .catch(() => setBrain(null))
      .finally(() => { brainLoadingRef.current = false; });
  }, [viewMode, community?.id, brain?.communityId]);

  // ── Expansion state ───────────────────────────────────────────────────────
  // Entries are plain type keys ("person" — whole folder open) or alias keys
  // ("person::Founder" — only that role out of the folder).
  const [expandedTypes, setExpandedTypes] = useState<ReadonlySet<string>>(new Set());
  // Folders mode: brain folder paths currently open.
  const [expandedFolders, setExpandedFolders] = useState<ReadonlySet<string>>(new Set());

  const expandType = useCallback((type: string) => {
    const key = folderTypeKey(type);
    setExpandedTypes(prev => {
      if (prev.has(key)) return prev;
      // Opening the whole folder absorbs any of its alias expansions.
      const next = new Set([...prev].filter(e => !e.startsWith(`${key}::`)));
      next.add(key);
      return next;
    });
  }, []);

  const expandAlias = useCallback((type: string, aliasName: string) => {
    const key = aliasExpansionKey(folderTypeKey(type), aliasName);
    setExpandedTypes(prev => (prev.has(key) ? prev : new Set([...prev, key])));
  }, []);

  const handleFolderOpen = useCallback((node: { id: string; type: string; name: string }) => {
    const id = String(node.id);
    if (isBrainFolderId(id)) {
      // Brain folders keep their node when open, so a second click collapses —
      // taking any open descendant folders down with it.
      const path = brainFolderPathOf(id);
      setExpandedFolders(prev => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
          [...next].forEach(p => { if (p.startsWith(`${path}/`)) next.delete(p); });
        } else {
          next.add(path);
        }
        return next;
      });
      return;
    }
    if (isAliasNodeId(id)) expandAlias(node.type, node.name);
    else expandType(node.type);
  }, [expandAlias, expandType]);

  const collapseEntry = useCallback((entry: string) => {
    setExpandedTypes(prev => {
      if (!prev.has(entry)) return prev;
      const next = new Set(prev);
      next.delete(entry);
      return next;
    });
  }, []);

  // A SEARCH match reveals the node and what it connects to. Clicking a node
  // deliberately does NOT restructure the graph — a click only highlights the
  // node's connections in place (the canvas's focus dimming); positions never
  // move under the cursor.
  const [revealNodeId, setRevealNodeId] = useState<string | null>(null);

  // Canonical entity-note path → entity node, for the Folders mode (an entity
  // note in the tree renders as the real entity card).
  const entityByPath = useMemo<Map<string, NBNode>>(() => {
    const map = new Map<string, NBNode>();
    contextData.nodes.forEach(n => {
      const path = entityNotePath({ id: String(n.id), type: n.type });
      if (path) map.set(path, n);
    });
    return map;
  }, [contextData.nodes]);

  const brainInput = useMemo<BrainViewInput | null>(() => {
    if (!brain) return null;
    return {
      tree: brain.tree,
      notes: brain.notes,
      entityByPath,
      entityLinks: contextData.links,
      expandedFolders,
      nodeTypes: community?.nodeTypes,
    };
  }, [brain, entityByPath, contextData.links, expandedFolders, community?.nodeTypes]);

  const displayDataRaw = useMemo<ContextData>(() => {
    if (viewMode === 'folders') {
      return brainInput ? buildBrainView(brainInput) : { nodes: [], links: [] };
    }
    return buildFolderView(contextData, expandedTypes, {
      nodeTypes: community?.nodeTypes,
      communityAliases: community?.communityAliases as CommunityAlias[] | undefined,
      revealNeighborsOf: revealNodeId,
    });
  }, [viewMode, brainInput, contextData, expandedTypes, revealNodeId, community?.nodeTypes, community?.communityAliases]);

  // Keep the object identity stable while the visible structure is unchanged —
  // a selection click whose neighbours are all already on screen must not
  // re-initialise the canvas (which would replay the intro and drop drags).
  const displaySignatureRef = useRef<{ signature: string; data: ContextData } | null>(null);
  const displayData = useMemo<ContextData>(() => {
    const signature =
      displayDataRaw.nodes.map(n => n.id).sort().join(',') +
      '::' +
      displayDataRaw.links
        .map(l => `${l.source}-${l.target}-${(l as { weight?: number }).weight ?? ''}`)
        .sort()
        .join(',');
    if (displaySignatureRef.current?.signature === signature) return displaySignatureRef.current.data;
    displaySignatureRef.current = { signature, data: displayDataRaw };
    return displayDataRaw;
  }, [displayDataRaw]);

  // The prescriptive layout. Folders mode is ALWAYS a deterministic radial
  // tree expanding outwards — never the force engine. Types mode uses the
  // iconic ring only when fully collapsed (anything expanded → null → engine).
  const layoutOverride = useMemo(() => {
    if (viewMode === 'folders') {
      return brainInput ? brainTreeLayout(brainInput) : null;
    }
    return typeRingLayout(displayData);
  }, [viewMode, brainInput, displayData]);

  // ── Session-local position memory ─────────────────────────────────────────
  // The canvas reports every settled/panned layout here; expand/collapse
  // transitions read it to seed where nodes GLIDE FROM. The final layout is
  // always the engine's (force-directed, crossing-reduced) — these are only
  // animation start points.
  const knownPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  const handlePersistLayout = useCallback((next: ContextLayoutData) => {
    const map = knownPositionsRef.current;
    Object.entries(next.positions).forEach(([id, p]) => map.set(id, p));
  }, []);

  // Seed (start) positions for the current structure: carried nodes start
  // where they were, expanded members start bunched at their folder's last
  // spot (they burst out of it), a re-collapsed folder starts at its members'
  // centroid. Null on first paint — the engine lays the folder map out cold.
  const seedPositions = useMemo<Map<string, { x: number; y: number }> | null>(() => {
    if (viewMode === 'folders') {
      return placeBrainView(displayData, knownPositionsRef.current, 60);
    }
    return placeFolderView(displayData, contextData.nodes, knownPositionsRef.current, 60);
    // knownPositionsRef is a ref on purpose: persists must not rebuild seeds.
  }, [viewMode, displayData, contextData.nodes]);

  // ── Text search dims non-matching nodes (the folder map stays visible) ────
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

  // Searching reveals just the best-matching node and what it connects to —
  // not its whole type. Clearing the search folds the reveal back (a later
  // click sets its own reveal through onNodeSelect).
  const prevSearchFocusRef = useRef<string | null>(null);
  useEffect(() => {
    if (focusedNodeId) {
      setRevealNodeId(focusedNodeId);
    } else if (prevSearchFocusRef.current) {
      setRevealNodeId(null);
    }
    prevSearchFocusRef.current = focusedNodeId;
  }, [focusedNodeId]);

  // Folders mode: a search match lives inside its note's folder — expand every
  // ancestor folder so the entity card is actually on screen to focus.
  useEffect(() => {
    if (viewMode !== 'folders' || !focusedNodeId) return;
    const node = contextData.nodes.find(n => String(n.id) === focusedNodeId);
    const path = node ? entityNotePath({ id: String(node.id), type: node.type }) : null;
    if (!path) return;
    const ancestors = ancestorFolders(path);
    setExpandedFolders(prev => {
      if (ancestors.every(a => prev.has(a))) return prev;
      return new Set([...prev, ...ancestors]);
    });
  }, [viewMode, focusedNodeId, contextData.nodes]);

  useEffect(() => {
    if (!onFocusNodeChange) return;
    const node = focusedNodeId ? contextData.nodes.find(n => n.id === focusedNodeId) : null;
    onFocusNodeChange(node ? { id: node.id, type: node.type } : null);
  }, [focusedNodeId, contextData.nodes, onFocusNodeChange]);

  // Chips for everything open — whole folders and single aliases alike.
  const expandedChips = useMemo(() => {
    if (viewMode === 'folders') {
      return [...expandedFolders].sort().map(path => ({
        entry: path,
        label: humanizeFolderName(path.split('/').pop() ?? path),
        color: getNodeTypeConfig(entityKindOf(path.split('/')[0]) ?? 'note', community?.nodeTypes).color,
      }));
    }
    const aliases = (community?.communityAliases as CommunityAlias[] | undefined) ?? [];
    return [...expandedTypes]
      .map(entry => {
        const [typeKey, aliasName] = entry.split('::');
        if (!contextData.nodes.some(n => folderTypeKey(n.type) === typeKey)) return null;
        const typeConfig = getNodeTypeConfig(typeKey, community?.nodeTypes);
        return aliasName
          ? {
              entry,
              label: aliasName,
              color: aliases.find(a => a.name === aliasName)?.color ?? typeConfig.color,
            }
          : { entry, label: pluralTypeLabel(typeKey, community?.nodeTypes), color: typeConfig.color };
      })
      .filter((chip): chip is { entry: string; label: string; color: string } => chip !== null);
  }, [viewMode, expandedFolders, expandedTypes, contextData.nodes, community?.nodeTypes, community?.communityAliases]);

  const collapseChip = useCallback((entry: string) => {
    if (viewMode === 'folders') {
      setExpandedFolders(prev => {
        const next = new Set(prev);
        next.delete(entry);
        [...next].forEach(p => { if (p.startsWith(`${entry}/`)) next.delete(p); });
        return next;
      });
      return;
    }
    collapseEntry(entry);
  }, [viewMode, collapseEntry]);

  return (
    <div className="relative h-full w-full">
      <ContextWithTable
        dataOverride={displayData}
        loadingOverride={loading || (viewMode === 'folders' && brain?.communityId !== community?.id)}
        errorOverride={error}
        focusNodeId={focusedNodeId}
        dimmedNodeIds={dimmedNodeIds}
        nodeTypes={community?.nodeTypes}
        linkTypes={community?.linkTypes}
        communityAliases={community?.communityAliases as CommunityAlias[] | undefined}
        seedPositions={seedPositions}
        layoutOverride={layoutOverride}
        // Search-reveal restructuring only exists in the type view; the
        // folders tree keeps its containment structure.
        egoNodeId={viewMode === 'types' ? revealNodeId : null}
        onPersistLayout={handlePersistLayout}
        onFolderOpen={handleFolderOpen}
      />
      {/* View mode selector: the folder tree is the default; Types is the
          force-directed by-type map. Top-right — search owns top-center. */}
      <div className="pointer-events-none absolute top-6 right-4 z-30">
        <div className="pointer-events-auto inline-flex rounded-lg border border-surface-3 bg-white/90 p-0.5 shadow-sm backdrop-blur">
          {([['folders', 'Folders'], ['types', 'Types']] as const).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              className={`rounded-md px-3 py-1 text-[12px] font-semibold transition-colors ${
                viewMode === mode ? 'bg-brand-green text-white' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {expandedChips.length > 0 && (
        <div className="pointer-events-none absolute bottom-4 left-4 z-10 flex flex-wrap items-center gap-2">
          {expandedChips.map(chip => (
            <button
              key={chip.entry}
              type="button"
              onClick={() => collapseChip(chip.entry)}
              className="pointer-events-auto inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm transition-opacity hover:opacity-80"
              style={{ backgroundColor: chip.color }}
              title={`Collapse ${chip.label}`}
            >
              {chip.label}
              <span aria-hidden className="text-white/80">×</span>
            </button>
          ))}
          {expandedChips.length > 1 && (
            <button
              type="button"
              onClick={() => (viewMode === 'folders' ? setExpandedFolders(new Set()) : setExpandedTypes(new Set()))}
              className="pointer-events-auto inline-flex items-center rounded-md border border-surface-3 bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-text-muted shadow-sm backdrop-blur transition-colors hover:bg-white"
            >
              Collapse all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
