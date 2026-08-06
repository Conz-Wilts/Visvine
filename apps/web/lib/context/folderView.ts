/**
 * Folder view over the context graph.
 *
 * Instead of drawing every entity, the default view groups nodes by type into
 * "folder" meta-nodes (People, Events, …) with counts, connected by aggregated
 * edges whose weight is the number of underlying links. Clicking a folder
 * expands it in place — its members take real positions and the folder
 * disappears; collapsing reverses it. Pure functions, no React/DOM, so the
 * grouping and edge-lifting rules are unit-testable.
 */

import type { ContextData, NBNode, NBLink, NodeTypeConfig, CommunityAlias } from '../types';
import { getNodeTypeConfig, findAlias } from '../types';

export const FOLDER_ID_PREFIX = 'folder:';

export const isFolderNodeId = (id: string): boolean => id.startsWith(FOLDER_ID_PREFIX);

/** Types are compared case-insensitively — data mixes 'Community' and
 *  'community', and they must land in one folder. */
export const folderTypeKey = (type: string): string => type.toLowerCase();

export const folderIdForType = (type: string): string => `${FOLDER_ID_PREFIX}${folderTypeKey(type)}`;

/** "Person" → "People", "Community" → "Communities", "Event" → "Events". */
export function pluralTypeLabel(type: string, nodeTypes?: NodeTypeConfig[]): string {
  const name = getNodeTypeConfig(type, nodeTypes).name;
  const lower = name.toLowerCase();
  if (lower === 'person') return name.charAt(0) === 'P' ? 'People' : 'people';
  if (lower.endsWith('y')) return `${name.slice(0, -1)}ies`;
  if (lower.endsWith('s') || lower.endsWith('x') || lower.endsWith('ch')) return `${name}es`;
  return `${name}s`;
}

const endpointId = (v: NBLink['source']): string =>
  typeof v === 'string' ? v : String((v as NBNode).id);

export function folderCount(node: NBNode): number {
  const count = node.metadata?.count;
  return typeof count === 'number' ? count : 0;
}

/** Main folder circle radius — grows gently with content so big folders read
 *  as big, bounded so a mega-folder can't dominate the map. */
export function folderRadius(count: number): number {
  return Math.min(200, 96 + 14 * Math.sqrt(count));
}

/** Alias breakdown circle radius — smaller than its parent folder. */
export function aliasRadius(count: number): number {
  return Math.min(88, 42 + 9 * Math.sqrt(count));
}

const ALIAS_ID_PREFIX = 'alias:';

export const isAliasNodeId = (id: string): boolean => id.startsWith(ALIAS_ID_PREFIX);

export function aliasNodeId(typeKey: string, aliasName: string): string {
  return `${ALIAS_ID_PREFIX}${typeKey}:${aliasName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

/**
 * Expansion-set entry for one alias of one type ("person::Founder").
 * The expansion set mixes plain type keys (whole folder open) with these
 * (only that role's members out of the folder).
 */
export function aliasExpansionKey(typeKey: string, aliasName: string): string {
  return `${typeKey}::${aliasName}`;
}

export interface FolderViewOptions {
  nodeTypes?: NodeTypeConfig[];
  communityAliases?: CommunityAlias[];
  /**
   * A selected node whose direct neighbours should be pulled out of their
   * folders — "show me everything this connects to". Cleared with the
   * selection, so the map folds back when the user clicks away.
   */
  revealNeighborsOf?: string | null;
}

/** The deterministic folder order shared by the ring edges and the ring
 *  layout, so neighbours on the drawn circle are exactly the linked ones. */
function orderedFolders(folders: NBNode[]): NBNode[] {
  return [...folders].sort(
    (a, b) => folderCount(b) - folderCount(a) || String(a.id).localeCompare(String(b.id)),
  );
}

/**
 * Derive the visible graph for a given expansion state.
 *
 * - Type folders link to each other in a circle (`types` edges) — the map's
 *   backbone is a ring of types.
 * - Types in `expandedTypes` contribute their real nodes.
 * - Every other type collapses to one folder node carrying `metadata.count`,
 *   with one small **alias circle** branching off it per alias present among
 *   its members (e.g. People → Founder ×5, Investor ×3) via `alias` edges —
 *   the role breakdown, readable before opening the folder.
 * - Links are remapped through the collapse: an edge to a hidden member
 *   re-targets its folder. Parallel remapped edges merge into one with
 *   `weight` = underlying link count, so folder edges honestly reflect how
 *   much connection they stand for. Edges collapsing to a self-loop drop.
 */
export function buildFolderView(
  data: ContextData,
  expandedTypes: ReadonlySet<string>,
  options: FolderViewOptions = {},
): ContextData {
  const { nodeTypes, communityAliases, revealNeighborsOf } = options;

  const typeOf = new Map<string, string>();
  data.nodes.forEach(n => typeOf.set(String(n.id), folderTypeKey(n.type)));

  // The selected node's neighbourhood: it and everything it directly links to
  // comes out of the folders while the selection lasts.
  const revealed = new Set<string>();
  if (revealNeighborsOf) {
    revealed.add(revealNeighborsOf);
    data.links.forEach(link => {
      const s = endpointId(link.source);
      const t = endpointId(link.target);
      if (s === revealNeighborsOf) revealed.add(t);
      if (t === revealNeighborsOf) revealed.add(s);
    });
  }

  const nodes: NBNode[] = [];
  const membersByType = new Map<string, NBNode[]>();
  data.nodes.forEach(n => {
    const key = folderTypeKey(n.type);
    const list = membersByType.get(key);
    if (list) list.push(n);
    else membersByType.set(key, [n]);
  });

  // Alias breakdown circles + member↔folder branch edges, collected here and
  // merged after the remap pass.
  const aliasLinks: Array<NBLink & { weight: number }> = [];
  // Real member nodes that made it on screen (whole type expanded, or their
  // alias expanded) — what the link remap resolves against.
  const visibleMemberIds = new Set<string>();

  membersByType.forEach((members, key) => {
    if (expandedTypes.has(key)) {
      nodes.push(...members);
      members.forEach(m => visibleMemberIds.add(String(m.id)));
      return;
    }
    // Only aliases the community actually configures for this type count —
    // events reuse the alias column for their public URL slug, which must
    // never surface as a role circle (same rule as nodeTypeLabel).
    const configuredAlias = (m: NBNode): string | null =>
      m.alias && findAlias(communityAliases, m.alias, m.type) ? m.alias : null;

    // An expanded alias pulls just that role's members out of the folder; a
    // revealed neighbourhood pulls individual members out regardless of role.
    const expandedMembers: Array<{ member: NBNode; viaAlias: string | null }> = [];
    const rest: NBNode[] = [];
    members.forEach(m => {
      const alias = configuredAlias(m);
      const aliasOut = alias != null && expandedTypes.has(aliasExpansionKey(key, alias));
      if (aliasOut || revealed.has(String(m.id))) {
        expandedMembers.push({ member: m, viaAlias: aliasOut ? alias : null });
      } else {
        rest.push(m);
      }
    });
    nodes.push(...expandedMembers.map(e => e.member));
    expandedMembers.forEach(e => visibleMemberIds.add(String(e.member.id)));

    if (rest.length === 0) return; // every member is out — no folder left

    // Carry a real member's type so colour/config resolution matches the
    // members the folder stands for.
    const type = members[0].type;
    nodes.push({
      id: folderIdForType(key),
      type,
      name: rest.length === 1
        ? getNodeTypeConfig(type, nodeTypes).name
        : pluralTypeLabel(type, nodeTypes),
      subtitle: null,
      tags: [],
      metadata: { folder: true, count: rest.length },
    });

    // Alias-expanded members stay visually attached to their type: a branch
    // edge to the folder labeled with their role. (Revealed neighbours don't
    // need one — their real edge to the selected node is the story.)
    expandedMembers.forEach(({ member, viaAlias }) => {
      if (!viaAlias) return;
      aliasLinks.push({
        source: folderIdForType(key),
        target: String(member.id),
        relationship: viaAlias,
        weight: 1,
      });
    });

    // One circle per remaining alias — the role breakdown (Founder ×5,
    // Investor ×3, …), each its own node branching off the folder. Setting
    // `alias` on the node lets the canvas resolve the configured alias
    // colour exactly like a member card would.
    const aliasCounts = new Map<string, { name: string; count: number }>();
    rest.forEach(m => {
      const alias = configuredAlias(m);
      if (!alias) return;
      const aliasKey = alias.toLowerCase();
      const entry = aliasCounts.get(aliasKey);
      if (entry) entry.count += 1;
      else aliasCounts.set(aliasKey, { name: alias, count: 1 });
    });
    aliasCounts.forEach(({ name, count }) => {
      const id = aliasNodeId(key, name);
      nodes.push({
        id,
        type,
        name,
        alias: name,
        subtitle: null,
        tags: [],
        metadata: { aliasNode: true, count, parentFolder: folderIdForType(key) },
      });
      aliasLinks.push({
        source: folderIdForType(key),
        target: id,
        relationship: 'alias',
        weight: count,
      });
    });
  });

  const mapEndpoint = (id: string): string | null => {
    if (visibleMemberIds.has(id)) return id;
    const key = typeOf.get(id);
    if (key === undefined) return null; // dangling endpoint — drop, same as the full view
    return folderIdForType(key);
  };

  // Merge remapped parallels: one edge per (endpoint pair, relationship kept
  // from the first underlying link), weighted by how many links it stands for.
  const merged = new Map<string, NBLink & { weight: number }>();
  data.links.forEach(link => {
    const source = mapEndpoint(endpointId(link.source));
    const target = mapEndpoint(endpointId(link.target));
    if (source === null || target === null || source === target) return;
    // Remapped folder-to-folder edges are dropped: the map's backbone is the
    // deliberate ring of types below, not incidental aggregates. (Edges
    // between an expanded member and a folder still draw; those carry real
    // signal.)
    if (isFolderNodeId(source) && isFolderNodeId(target)) return;
    const key = source < target ? `${source}|${target}` : `${target}|${source}`;
    const existing = merged.get(key);
    if (existing) {
      existing.weight += 1;
    } else {
      merged.set(key, { ...link, source, target, weight: 1 });
    }
  });

  aliasLinks.forEach(link => {
    const s = String(link.source);
    const t = String(link.target);
    const key = s < t ? `${s}|${t}` : `${t}|${s}`;
    // A real remapped edge between the pair (e.g. an actual member_of) wins
    // over the synthesized branch edge.
    if (!merged.has(key)) merged.set(key, link);
  });

  // The map's backbone: type folders joined to each other in a circle. The
  // order matches the ring layout, so the drawn circle's neighbours are
  // exactly the linked ones.
  const ring = orderedFolders(nodes.filter(n => isFolderNodeId(String(n.id))));
  if (ring.length >= 2) {
    ring.forEach((folder, i) => {
      if (ring.length === 2 && i === 1) return; // two folders → one edge, not two
      const next = ring[(i + 1) % ring.length];
      const a = String(folder.id);
      const b = String(next.id);
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (!merged.has(key)) {
        merged.set(key, { source: a, target: b, relationship: 'types', weight: 1 });
      }
    });
  }

  return { nodes, links: [...merged.values()] };
}

/**
 * The fully-collapsed map: every type folder on one circle — the deliberate,
 * iconic opening view, matching the ring of `types` edges buildFolderView
 * emits. Returns null when the shape doesn't apply (no folders, or anything
 * is expanded — the force engine owns those layouts). Deterministic: folders
 * order by size (id tiebreak) clockwise from the top, each claiming ring arc
 * proportional to its footprint; alias circles fan outward from their folder.
 */
export function typeRingLayout(
  visible: ContextData,
): Map<string, { x: number; y: number }> | null {
  const folders = visible.nodes.filter(n => isFolderNodeId(String(n.id)));
  const aliasNodes = visible.nodes.filter(n => isAliasNodeId(String(n.id)));
  if (folders.length === 0) return null;
  if (visible.nodes.length !== folders.length + aliasNodes.length) return null; // something is expanded

  const aliasesByFolder = new Map<string, NBNode[]>();
  aliasNodes.forEach(a => {
    const parent = String((a.metadata as { parentFolder?: string } | undefined)?.parentFolder ?? '');
    const list = aliasesByFolder.get(parent);
    if (list) list.push(a);
    else aliasesByFolder.set(parent, [a]);
  });
  aliasesByFolder.forEach(list =>
    list.sort((a, b) => folderCount(b) - folderCount(a) || String(a.id).localeCompare(String(b.id))));

  // A folder's ring footprint includes its alias fan, which sits outward of it.
  const ALIAS_GAP = 36;
  const fanExtent = (folderId: string): number => {
    const aliases = aliasesByFolder.get(folderId) ?? [];
    if (aliases.length === 0) return 0;
    const maxAliasR = Math.max(...aliases.map(a => aliasRadius(folderCount(a))));
    return 2 * maxAliasR + ALIAS_GAP;
  };

  const sorted = orderedFolders(folders);
  const outers = sorted.map(f => folderRadius(folderCount(f)) + fanExtent(String(f.id)));
  const GAP = 110;
  const circumference = outers.reduce((sum, r) => sum + 2 * r + GAP, 0);
  const radius = Math.max(320, Math.max(...outers) + 140, circumference / (2 * Math.PI));

  const positions = new Map<string, { x: number; y: number }>();
  let travelled = 0;
  sorted.forEach((folder, i) => {
    const half = outers[i] + GAP / 2;
    const theta = -Math.PI / 2 + ((travelled + half) / circumference) * 2 * Math.PI;
    travelled += 2 * half;
    const fx = radius * Math.cos(theta);
    const fy = radius * Math.sin(theta);
    positions.set(String(folder.id), { x: fx, y: fy });

    // Alias circles fan outward from the ring, centred on the folder's own
    // outward direction so they never crowd the circle's interior.
    const aliases = aliasesByFolder.get(String(folder.id)) ?? [];
    aliases.forEach((alias, j) => {
      const aliasR = aliasRadius(folderCount(alias));
      const orbit = folderRadius(folderCount(folder)) + aliasR + ALIAS_GAP;
      const spreadStep = 2 * Math.atan2(aliasR + 14, orbit);
      const offset = (j - (aliases.length - 1) / 2) * spreadStep;
      positions.set(String(alias.id), {
        x: fx + orbit * Math.cos(theta + offset),
        y: fy + orbit * Math.sin(theta + offset),
      });
    });
  });
  return positions;
}

/**
 * Seed positions for a folder-view structure change — where each visible node
 * STARTS before the layout engine's force-directed, crossing-reduced result
 * is animated in:
 * - carried-over nodes start at their known position;
 * - members of a newly expanded folder start on a tight golden-angle spiral
 *   at the folder's last position (they visibly burst out of it);
 * - a re-collapsed folder starts at the centroid of where its members were.
 * Returns null when nothing is known yet (first paint — the engine lays the
 * folder map out cold, no animation source exists).
 */
export function placeFolderView(
  visible: ContextData,
  fullNodes: NBNode[],
  known: ReadonlyMap<string, { x: number; y: number }>,
  spread = 300,
): Map<string, { x: number; y: number }> | null {
  if (known.size === 0) return null;

  const byType = new Map<string, NBNode[]>();
  fullNodes.forEach(n => {
    const key = folderTypeKey(n.type);
    const list = byType.get(key);
    if (list) list.push(n);
    else byType.set(key, [n]);
  });

  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

  const positions = new Map<string, { x: number; y: number }>();
  // Per-type spiral cursor so all members of one newly expanded folder share
  // one spiral even though we visit them node by node.
  const spiralIndex = new Map<string, number>();

  const centroidOf = (ids: string[]): { x: number; y: number } | null => {
    let sx = 0, sy = 0, n = 0;
    ids.forEach(id => {
      const p = known.get(id);
      if (p) { sx += p.x; sy += p.y; n += 1; }
    });
    return n > 0 ? { x: sx / n, y: sy / n } : null;
  };

  visible.nodes.forEach(node => {
    const id = String(node.id);
    const knownPos = known.get(id);
    if (knownPos) {
      positions.set(id, knownPos);
      return;
    }
    const key = folderTypeKey(node.type);
    if (isFolderNodeId(id)) {
      // Folder reappearing after a collapse: sit where its members were.
      const memberIds = (byType.get(key) ?? []).map(n => String(n.id));
      positions.set(id, centroidOf(memberIds) ?? { x: 0, y: 0 });
      return;
    }
    // Member of a freshly expanded folder or alias: spiral out from its alias
    // circle's last position when it had one (an alias expansion visibly
    // bursts out of that circle), else the folder's, else the members' own
    // last known centroid.
    const aliasAnchorId = node.alias ? aliasNodeId(key, node.alias) : null;
    const anchorId = aliasAnchorId && known.has(aliasAnchorId) ? aliasAnchorId : folderIdForType(key);
    const anchor =
      known.get(anchorId) ??
      centroidOf((byType.get(key) ?? []).map(n => String(n.id))) ??
      { x: 0, y: 0 };
    const i = spiralIndex.get(anchorId) ?? 0;
    spiralIndex.set(anchorId, i + 1);
    const r = i === 0 ? 0 : spread * Math.sqrt(i);
    const theta = i * GOLDEN_ANGLE;
    positions.set(id, { x: anchor.x + r * Math.cos(theta), y: anchor.y + r * Math.sin(theta) });
  });

  return positions;
}
