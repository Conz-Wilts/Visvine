import type { AgentFolder, AgentSummary } from '@/lib/agents/service';
import type { Tone } from '@/features/shared/lib/statusTone';
import { statusLine } from './rowState';

/**
 * The roster as a tree: folders of agents (each one an index note under
 * `agents/`) holding agents and further folders. Built from the flat lists the
 * API returns, so nothing here touches the network. Pure — tested directly.
 */
export interface AgentTreeFolder {
  kind: 'folder';
  folder: AgentFolder;
  depth: number;
  children: AgentTreeNode[];
  /** Agents anywhere beneath, for the count and the summary dot. */
  agentCount: number;
  /** The loudest tone among the agents beneath — what a collapsed folder shows. */
  tone: Tone;
}

export interface AgentTreeLeaf {
  kind: 'agent';
  agent: AgentSummary;
  depth: number;
}

export type AgentTreeNode = AgentTreeFolder | AgentTreeLeaf;

// The order a folder's dot reports in: a problem beats a live run beats calm.
const TONE_RANK: Record<Tone, number> = { bad: 4, warn: 3, live: 2, ok: 1, muted: 0 };

function louder(a: Tone, b: Tone): Tone {
  return TONE_RANK[b] > TONE_RANK[a] ? b : a;
}

export function buildAgentTree(folders: AgentFolder[], agents: AgentSummary[], now = Date.now()): AgentTreeNode[] {
  const byPath = new Map<string, AgentTreeFolder>();
  const root: AgentTreeNode[] = [];
  const sorted = [...folders].sort((a, b) => a.path.localeCompare(b.path));
  for (const folder of sorted) {
    const segments = folder.path.split('/');
    const parent = segments.length > 1 ? byPath.get(segments.slice(0, -1).join('/')) : null;
    const node: AgentTreeFolder = { kind: 'folder', folder, depth: parent ? parent.depth + 1 : 0, children: [], agentCount: 0, tone: 'muted' };
    byPath.set(folder.path, node);
    (parent ? parent.children : root).push(node);
  }
  for (const agent of agents) {
    const parent = agent.folder ? byPath.get(agent.folder) : null;
    const leaf: AgentTreeLeaf = { kind: 'agent', agent, depth: parent ? parent.depth + 1 : 0 };
    (parent ? parent.children : root).push(leaf);
    const tone = statusLine(agent, now).tone;
    for (let f = parent, path = agent.folder; f; ) {
      f.agentCount += 1;
      f.tone = louder(f.tone, tone);
      const up = path.split('/').slice(0, -1).join('/');
      f = up ? byPath.get(up) ?? null : null;
      path = up;
    }
  }
  const order = (nodes: AgentTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
      const la = a.kind === 'folder' ? a.folder.title : a.agent.title || a.agent.name;
      const lb = b.kind === 'folder' ? b.folder.title : b.agent.title || b.agent.name;
      return la.localeCompare(lb, undefined, { sensitivity: 'base' });
    });
    for (const n of nodes) if (n.kind === 'folder') order(n.children);
  };
  order(root);
  return root;
}

/** The rows a tree renders, top to bottom, skipping what sits under a collapsed folder. */
export function flattenAgentTree(nodes: AgentTreeNode[], collapsed: ReadonlySet<string>): AgentTreeNode[] {
  const out: AgentTreeNode[] = [];
  const walk = (list: AgentTreeNode[]) => {
    for (const n of list) {
      out.push(n);
      if (n.kind === 'folder' && !collapsed.has(n.folder.path)) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}
