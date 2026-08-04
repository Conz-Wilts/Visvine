import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBrainView,
  brainTreeLayout,
  placeBrainView,
  brainFolderNodeId,
  noteNodeId,
  isBrainFolderId,
  type BrainViewInput,
} from '../lib/context/brainView';
import type { TreeNode, NoteMeta } from '../lib/notes/shared/types';
import type { NBNode, NBLink } from '../lib/types';

const person = (slug: string, name: string): NBNode => ({
  id: `person:${slug}`,
  type: 'person',
  name,
  subtitle: '',
  tags: [],
});

const org = (slug: string, name: string): NBNode => ({
  id: `community:${slug}`,
  type: 'community',
  name,
  subtitle: '',
  tags: [],
});

const noteMeta = (path: string, linkTargets: string[] = []): NoteMeta => ({
  path,
  title: path.split('/').pop()!.replace(/\.md$/, ''),
  folder: path.split('/').slice(0, -1).join('/'),
  frontmatter: {},
  tags: [],
  linkTargets,
  unresolved: [],
  mtime: 0,
});

const TREE: TreeNode = {
  name: '',
  path: '',
  kind: 'folder',
  children: [
    {
      name: 'people',
      path: 'people',
      kind: 'folder',
      children: [
        { name: 'index.md', path: 'people/index.md', kind: 'note', title: 'People' },
        { name: 'ava.md', path: 'people/ava.md', kind: 'note', title: 'Ava Chen' },
      ],
    },
    {
      name: 'communities',
      path: 'communities',
      kind: 'folder',
      children: [
        { name: 'fernwave.md', path: 'communities/fernwave.md', kind: 'note', title: 'Fernwave' },
      ],
    },
    {
      name: 'meetings',
      path: 'meetings',
      kind: 'folder',
      children: [
        { name: 'sync.md', path: 'meetings/sync.md', kind: 'note', title: 'Weekly Sync' },
      ],
    },
  ],
};

const AVA = person('ava', 'Ava Chen');
const FERNWAVE = org('fernwave', 'Fernwave');
const ENTITY_BY_PATH = new Map<string, NBNode>([
  ['people/ava.md', AVA],
  ['communities/fernwave.md', FERNWAVE],
]);
const ENTITY_LINKS: NBLink[] = [
  { source: 'person:ava', target: 'community:fernwave', relationship: 'works_at' },
];
const NOTES: NoteMeta[] = [
  noteMeta('people/ava.md', ['communities/fernwave.md']),
  noteMeta('communities/fernwave.md'),
  noteMeta('meetings/sync.md', ['communities/fernwave.md', 'people/ava.md']),
];

const input = (expanded: string[]): BrainViewInput => ({
  tree: TREE,
  notes: NOTES,
  entityByPath: ENTITY_BY_PATH,
  entityLinks: ENTITY_LINKS,
  expandedFolders: new Set(expanded),
});

test('collapsed: one folder node per brain folder, counts exclude index notes', () => {
  const view = buildBrainView(input([]));
  assert.equal(view.nodes.length, 3);
  assert.ok(view.nodes.every(n => isBrainFolderId(String(n.id))));
  const people = view.nodes.find(n => n.id === brainFolderNodeId('people'))!;
  assert.equal(people.metadata?.count, 1); // index.md excluded
  // Entity dirs wear their entity type; custom folders stay neutral.
  assert.equal(people.type, 'person');
  assert.equal(view.nodes.find(n => n.id === brainFolderNodeId('meetings'))!.type, 'note');
});

test('collapsed: no visible edges at rest — folder↔folder rollups all drop', () => {
  const view = buildBrainView(input([]));
  assert.equal(view.links.length, 0);
});

test('expanded folder keeps its node; children hang off it via contains', () => {
  const view = buildBrainView(input(['people']));
  const folderId = brainFolderNodeId('people');
  assert.ok(view.nodes.some(n => n.id === folderId));
  assert.ok(view.nodes.some(n => n.id === 'person:ava'), 'entity note renders as the entity');
  assert.ok(!view.nodes.some(n => String(n.id).includes('index')), 'index note never surfaces');
  assert.ok(view.links.some(l =>
    l.relationship === 'contains' && l.source === folderId && l.target === 'person:ava'));
  // Contains edges draw at rest; everything else is quiet.
  view.links.forEach(l => {
    if (l.relationship !== 'contains') {
      assert.equal((l as { quiet?: boolean }).quiet, true);
    }
  });
});

test('mentions surface as quiet edges, hidden endpoints remap to their folder', () => {
  const view = buildBrainView(input(['meetings', 'people']));
  const syncId = noteNodeId('meetings/sync.md');
  assert.ok(view.nodes.some(n => n.id === syncId));
  // sync.md mentions Ava (visible entity) → quiet note→entity edge.
  const toAva = view.links.find(l => {
    const pair = [String(l.source), String(l.target)];
    return l.relationship === 'mentioned' && pair.includes(syncId) && pair.includes('person:ava');
  });
  assert.ok(toAva);
  assert.equal((toAva as { quiet?: boolean }).quiet, true);
  // sync.md also mentions Fernwave (hidden) → remaps to the communities folder.
  assert.ok(view.links.some(l => {
    const pair = [String(l.source), String(l.target)];
    return pair.includes(syncId) && pair.includes(brainFolderNodeId('communities'));
  }));
});

test('entity links remap hidden endpoints to their folder, as quiet edges', () => {
  const view = buildBrainView(input(['people']));
  // ava (visible) works_at fernwave (hidden in communities/).
  const edge = view.links.find(l => {
    const pair = [String(l.source), String(l.target)];
    return l.relationship === 'works_at' &&
      pair.includes('person:ava') && pair.includes(brainFolderNodeId('communities'));
  });
  assert.ok(edge);
  assert.equal((edge as { quiet?: boolean }).quiet, true);
});

test('brainTreeLayout: radial tree — children sit outward of their parent', () => {
  const layout = brainTreeLayout(input(['people']));
  const folder = layout.get(brainFolderNodeId('people'))!;
  const ava = layout.get('person:ava')!;
  const rFolder = Math.hypot(folder.x, folder.y);
  const rAva = Math.hypot(ava.x, ava.y);
  assert.ok(rAva > rFolder, 'child ring lies outside the parent ring');
  // Every position finite; deterministic across runs.
  layout.forEach(p => {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  });
  const again = brainTreeLayout(input(['people']));
  layout.forEach((p, id) => assert.deepEqual(again.get(id), p));
});

test('brainTreeLayout: children stay inside their parent wedge', () => {
  const layout = brainTreeLayout(input(['people', 'communities']));
  const angleOf = (p: { x: number; y: number }) => Math.atan2(p.y, p.x);
  const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  // Ava's angle matches her parent folder's mid-angle (single child = whole wedge).
  const ava = angleOf(layout.get('person:ava')!);
  const people = angleOf(layout.get(brainFolderNodeId('people'))!);
  assert.ok(Math.abs(norm(ava) - norm(people)) < 1e-9);
});

test('placeBrainView: carried nodes keep positions, new ones spiral from their parent', () => {
  const view = buildBrainView(input(['people']));
  const folderId = brainFolderNodeId('people');
  const known = new Map([[folderId, { x: 120, y: -40 }]]);
  const seeds = placeBrainView(view, known, 50)!;
  assert.deepEqual(seeds.get(folderId), { x: 120, y: -40 });
  const ava = seeds.get('person:ava')!;
  // First child of the spiral starts AT the folder — it bursts out of it.
  assert.ok(Math.hypot(ava.x - 120, ava.y + 40) <= 50 * Math.sqrt(2) + 1e-9);
  assert.equal(placeBrainView(view, new Map(), 50), null);
});
