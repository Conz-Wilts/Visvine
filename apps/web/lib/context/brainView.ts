/**
 * Brain-folder view over the context graph — the DEFAULT "Folders" mode.
 *
 * Where the type view groups entities by TYPE and hands the picture to the
 * force engine, this one mirrors the brain's index-folder tree and lays it out
 * as a deterministic RADIAL TREE expanding outwards: top-level folders on the
 * innermost ring, an expanded folder's children fanning outward inside their
 * parent's angular wedge. Entity context notes render as the real entity
 * cards; every other note renders as a small note circle.
 *
 * Only the containment tree draws at rest. Mention edges (from each note's
 * resolved linkTargets) and the community's real entity links are carried as
 * `quiet` links — invisible until a focus/hover lights them — so the map reads
 * as a tree, not a hairball, while clicking a node still reveals what it
 * connects to. Endpoints hidden inside a collapsed folder remap to that
 * folder; folder↔folder rollups drop.
 *
 * Pure functions, no React/DOM — unit-testable beside folderView.
 */

import type { ContextData, NBNode, NBLink, NodeTypeConfig } from '../types';
import { getNodeTypeConfig } from '../types';
import type { TreeNode, NoteMeta } from '../notes/shared/types';
import { isIndexPath, ancestorFolders, humanizeFolderName } from '../notes/shared/indexNote';
import { entityKindOf } from '../notes/entities';
import { FOLDER_ID_PREFIX, isFolderNodeId, folderRadius } from './folderView';

/** Brain folder meta-nodes share the `folder:` prefix (so click-to-expand,
 *  radii and hit-testing all apply) under their own namespace. */
const BRAIN_FOLDER_ID_PREFIX = `${FOLDER_ID_PREFIX}brain/`;

export const isBrainFolderId = (id: string): boolean => id.startsWith(BRAIN_FOLDER_ID_PREFIX);

export const brainFolderNodeId = (path: string): string => `${BRAIN_FOLDER_ID_PREFIX}${path}`;

export const brainFolderPathOf = (id: string): string => id.slice(BRAIN_FOLDER_ID_PREFIX.length);

/** Synthetic display nodes for plain (non-entity) notes. */
const NOTE_NODE_ID_PREFIX = 'note-node:';

export const isNoteNodeId = (id: string): boolean => id.startsWith(NOTE_NODE_ID_PREFIX);

export const noteNodeId = (path: string): string => `${NOTE_NODE_ID_PREFIX}${path}`;

export const notePathOfNodeId = (id: string): string => id.slice(NOTE_NODE_ID_PREFIX.length);

/** Plain notes draw as small fixed circles — content, but lighter than cards. */
export const NOTE_NODE_RADIUS = 44;

export interface BrainViewInput {
  /** The brain's folder/note tree (root node from /api/notes/tree). */
  tree: TreeNode;
  /** All note metas — linkTargets drive the (quiet) mention edges. */
  notes: NoteMeta[];
  /** Canonical entity-note path → entity node (built via entityNotePath). */
  entityByPath: ReadonlyMap<string, NBNode>;
  /** The community's real links (entity ↔ entity), carried as quiet edges. */
  entityLinks: NBLink[];
  /** Folder paths currently expanded. */
  expandedFolders: ReadonlySet<string>;
  /** Community node-type overrides — resolves card shapes for layout extents. */
  nodeTypes?: NodeTypeConfig[];
}

const endpointId = (v: NBLink['source']): string =>
  typeof v === 'string' ? v : String((v as NBNode).id);

/** Recursive note count of a folder, excluding index notes — the number the
 *  folder circle wears. */
function countNotes(folder: TreeNode): number {
  let n = 0;
  for (const child of folder.children ?? []) {
    if (child.kind === 'folder') n += countNotes(child);
    else if (!isIndexPath(child.path)) n += 1;
  }
  return n;
}

/** One node of the VISIBLE tree (folders always; contents only when their
 *  parent is expanded), shared by the graph builder and the radial layout. */
interface VisibleTreeNode {
  node: NBNode;
  /** Circumscribed radius — the space the drawn node claims. */
  extent: number;
  children: VisibleTreeNode[];
}

function cardExtent(node: NBNode, nodeTypes?: NodeTypeConfig[]): number {
  const shape = getNodeTypeConfig(node.type, nodeTypes).shape;
  // Circumradii of the 140×215 rectangle / 192×268 community cards — matches
  // the radii ContextWithTable hands the force engine in the type view.
  return shape === 'square' || shape === 'hexagon'
    ? Math.hypot(192, 268) / 2
    : Math.hypot(140, 215) / 2;
}

/** Build the visible tree for the current expansion state. */
function visibleTree(input: BrainViewInput): VisibleTreeNode[] {
  const { entityByPath, expandedFolders, nodeTypes } = input;

  const walk = (folder: TreeNode, parentId: string | null): VisibleTreeNode[] => {
    const out: VisibleTreeNode[] = [];
    for (const child of folder.children ?? []) {
      if (child.kind === 'folder') {
        const id = brainFolderNodeId(child.path);
        const expanded = expandedFolders.has(child.path);
        const node: NBNode = {
          id,
          // Entity dirs wear their entity type so the folder takes that type's
          // colour (people/ renders person-blue); custom folders stay neutral.
          type: entityKindOf(child.name) ?? 'note',
          name: humanizeFolderName(child.name),
          subtitle: null,
          tags: [],
          metadata: {
            folder: true,
            count: countNotes(child),
            brainFolder: child.path,
            ...(parentId ? { brainParentId: parentId } : {}),
          },
        };
        out.push({
          node,
          extent: folderRadius(countNotes(child)),
          children: expanded ? walk(child, id) : [],
        });
        continue;
      }
      if (isIndexPath(child.path)) continue; // the folder node IS the index
      const entity = entityByPath.get(child.path);
      if (entity) {
        const node: NBNode = {
          ...entity,
          metadata: { ...entity.metadata, ...(parentId ? { brainParentId: parentId } : {}) },
        };
        out.push({ node, extent: cardExtent(entity, nodeTypes), children: [] });
      } else if (child.path.endsWith('.md')) {
        const node: NBNode = {
          id: noteNodeId(child.path),
          type: 'note',
          name: child.title ?? child.name.replace(/\.md$/, ''),
          subtitle: null,
          tags: [],
          metadata: {
            noteNode: true,
            notePath: child.path,
            ...(parentId ? { brainParentId: parentId } : {}),
          },
        };
        out.push({ node, extent: NOTE_NODE_RADIUS, children: [] });
      }
    }
    return out;
  };

  return walk(input.tree, null);
}

/**
 * Derive the visible graph for the Folders mode. Structure edges ('contains')
 * draw at rest; mention and entity edges are `quiet` — the renderer shows
 * them only while a focus/hover lights them.
 */
export function buildBrainView(input: BrainViewInput): ContextData {
  const { notes, entityByPath, entityLinks } = input;

  const roots = visibleTree(input);
  const nodes: NBNode[] = [];
  const links = new Map<string, NBLink & { weight: number; quiet?: boolean }>();
  /** Folder path → its visible meta-node id. */
  const folderIdByPath = new Map<string, string>();
  /** Note path → the visible node standing for it (entity card or note circle). */
  const nodeIdByNotePath = new Map<string, string>();

  const collect = (vnode: VisibleTreeNode, parentId: string | null): void => {
    const id = String(vnode.node.id);
    nodes.push(vnode.node);
    const meta = vnode.node.metadata as { brainFolder?: string; notePath?: string } | undefined;
    if (meta?.brainFolder) folderIdByPath.set(meta.brainFolder, id);
    else if (meta?.notePath) nodeIdByNotePath.set(meta.notePath, id);
    else {
      // An entity card: index its canonical note path via the entity map.
      const path = pathForEntityId(id, entityByPath);
      if (path) nodeIdByNotePath.set(path, id);
    }
    if (parentId) {
      const key = parentId < id ? `${parentId}|${id}` : `${id}|${parentId}`;
      links.set(key, { source: parentId, target: id, relationship: 'contains', weight: 1 });
    }
    vnode.children.forEach(child => collect(child, id));
  };
  roots.forEach(root => collect(root, null));

  // Resolve any note path to the node standing for it on screen: the note's
  // own node when visible, else its deepest visible ancestor folder.
  const visibleIdForPath = (path: string): string | null => {
    const direct = nodeIdByNotePath.get(path);
    if (direct) return direct;
    const folders = ancestorFolders(path);
    for (let i = folders.length - 1; i >= 0; i--) {
      const id = folderIdByPath.get(folders[i]);
      if (id) return id;
    }
    return null;
  };

  const addQuiet = (source: string, target: string, relationship: string): void => {
    if (source === target) return;
    // Folder↔folder rollups drop — the tree is the structure; aggregates on
    // top of it would read as relationships that aren't there.
    if (isFolderNodeId(source) && isFolderNodeId(target)) return;
    const key = source < target ? `${source}|${target}` : `${target}|${source}`;
    const existing = links.get(key);
    if (existing) {
      if (!existing.quiet) return; // containment already tells this story
      existing.weight += 1;
      return;
    }
    links.set(key, { source, target, relationship, weight: 1, quiet: true });
  };

  // The community's real entity links, remapped through the collapse.
  entityLinks.forEach(link => {
    const sPath = pathForEntityId(endpointId(link.source), entityByPath);
    const tPath = pathForEntityId(endpointId(link.target), entityByPath);
    if (!sPath || !tPath) return;
    const source = visibleIdForPath(sPath);
    const target = visibleIdForPath(tPath);
    if (!source || !target) return;
    addQuiet(source, target, String(link.relationship ?? 'related'));
  });

  // Note→note mentions. Entity↔entity mentions already exist as real links
  // above (the note sync owns them); the pair-dedupe keeps them single.
  notes.forEach(meta => {
    if (isIndexPath(meta.path)) return; // curated index lists = containment, already drawn
    const from = visibleIdForPath(meta.path);
    if (!from) return;
    meta.linkTargets.forEach(targetPath => {
      if (isIndexPath(targetPath)) return;
      const to = visibleIdForPath(targetPath);
      if (!to) return;
      addQuiet(from, to, 'mentioned');
    });
  });

  return { nodes, links: [...links.values()] };
}

/** An entity node id's canonical note path, via the loaded entity map (node
 *  ids are not reconstructible from paths by string surgery — see entities.ts). */
function pathForEntityId(id: string, entityByPath: ReadonlyMap<string, NBNode>): string | null {
  const cached = pathByIdCache.get(entityByPath);
  if (cached) return cached.get(id) ?? null;
  const map = new Map<string, string>();
  entityByPath.forEach((node, path) => map.set(String(node.id), path));
  pathByIdCache.set(entityByPath, map);
  return map.get(id) ?? null;
}
const pathByIdCache = new WeakMap<ReadonlyMap<string, NBNode>, Map<string, string>>();

/**
 * Deterministic radial tree layout for the Folders mode — the tree expands
 * OUTWARDS from the centre instead of being force-simulated:
 *
 * - top-level folders sit on the innermost ring, wedges of the full circle
 *   sized by their visible leaf count;
 * - an expanded folder's children fan outward on the next ring, confined to
 *   their parent's wedge (so subtrees never interleave);
 * - ring radii accumulate the deepest nodes' extents, then every ring is
 *   scaled up together until the widest node fits its wedge's arc.
 *
 * Same input ⇒ same picture; no simulation, no reshuffling.
 */
export function brainTreeLayout(input: BrainViewInput): Map<string, { x: number; y: number }> {
  const roots = visibleTree(input);
  const positions = new Map<string, { x: number; y: number }>();
  if (roots.length === 0) return positions;

  const leaves = (v: VisibleTreeNode): number =>
    v.children.length === 0 ? 1 : v.children.reduce((n, c) => n + leaves(c), 0);

  // Per-depth max extent → cumulative ring radii with clearance between rings.
  const maxExtentAtDepth: number[] = [];
  const scan = (nodes: VisibleTreeNode[], depth: number): void => {
    nodes.forEach(v => {
      maxExtentAtDepth[depth] = Math.max(maxExtentAtDepth[depth] ?? 0, v.extent);
      scan(v.children, depth + 1);
    });
  };
  scan(roots, 0);

  const RING_GAP = 140;
  const radii: number[] = [];
  maxExtentAtDepth.forEach((ext, d) => {
    radii[d] = d === 0
      ? Math.max(320, ext + 180)
      : radii[d - 1] + maxExtentAtDepth[d - 1] + ext + RING_GAP;
  });

  // Wedge assignment (leaf-proportional), collecting each node's angular span
  // so the arc-fit pass below can widen the rings if any card outgrows its arc.
  interface Placed { v: VisibleTreeNode; depth: number; mid: number; span: number }
  const placed: Placed[] = [];
  const assign = (nodes: VisibleTreeNode[], depth: number, start: number, span: number): void => {
    const total = nodes.reduce((n, v) => n + leaves(v), 0);
    let cursor = start;
    nodes.forEach(v => {
      const w = (leaves(v) / total) * span;
      placed.push({ v, depth, mid: cursor + w / 2, span: w });
      assign(v.children, depth + 1, cursor, w);
      cursor += w;
    });
  };
  assign(roots, 0, -Math.PI / 2, Math.PI * 2);

  // Widen all rings together until every node's footprint (chord ≈ arc) fits
  // inside its wedge at its ring radius.
  const ARC_GAP = 70;
  let scale = 1;
  placed.forEach(({ v, depth, span }) => {
    const needed = (2 * v.extent + ARC_GAP) / (span * radii[depth]);
    if (needed > scale) scale = needed;
  });

  placed.forEach(({ v, depth, mid }) => {
    const r = radii[depth] * scale;
    positions.set(String(v.node.id), { x: r * Math.cos(mid), y: r * Math.sin(mid) });
  });

  return positions;
}

/**
 * Seed (start) positions for a Folders-mode structure change: carried nodes
 * start where they were; a newly revealed node starts on a tight golden-angle
 * spiral at its parent folder's last position (it bursts out of the folder).
 * Null when nothing is known yet (first paint renders the tree cold).
 */
export function placeBrainView(
  visible: ContextData,
  known: ReadonlyMap<string, { x: number; y: number }>,
  spread = 300,
): Map<string, { x: number; y: number }> | null {
  if (known.size === 0) return null;

  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
  const positions = new Map<string, { x: number; y: number }>();
  const spiralIndex = new Map<string, number>();

  visible.nodes.forEach(node => {
    const id = String(node.id);
    const knownPos = known.get(id);
    if (knownPos) {
      positions.set(id, knownPos);
      return;
    }
    const anchorId = String(node.metadata?.brainParentId ?? '');
    const anchor = known.get(anchorId) ?? { x: 0, y: 0 };
    const i = spiralIndex.get(anchorId) ?? 0;
    spiralIndex.set(anchorId, i + 1);
    const r = i === 0 ? 0 : spread * Math.sqrt(i);
    const theta = i * GOLDEN_ANGLE;
    positions.set(id, { x: anchor.x + r * Math.cos(theta), y: anchor.y + r * Math.sin(theta) });
  });

  return positions;
}
