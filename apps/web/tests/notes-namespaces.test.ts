// The reserved-namespace table: the one place that says which folder a kind is
// filed under, which tool owns it, whether it stands empty and what its index
// says it holds. These are the rules the table has to keep for the four things
// that read it (entities.ts, indexNote.ts, the tree route, the write gate).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RESERVED_NAMESPACES,
  dirOfKind,
  namespaceDirs,
  namespaceOf,
  namespaceFeatureRefusal,
  reservedDescriptions,
  standingFolders,
  togglableNamespaceFeature,
} from '../lib/notes/shared/namespaces';
import { entityKindOfDir, isEntityNamespaceDir } from '../lib/notes/entities';

test('the table names each folder once, and each kind once', () => {
  const dirs = namespaceDirs();
  assert.equal(new Set(dirs).size, dirs.length);

  const kinds = RESERVED_NAMESPACES.map((ns) => ns.kind).filter(Boolean);
  assert.equal(new Set(kinds).size, kinds.length);

  // Every kind resolves to its folder, and the projection entities.ts builds
  // from it agrees — the two lists cannot drift because there is only one.
  for (const ns of RESERVED_NAMESPACES) {
    if (!ns.kind) continue;
    assert.equal(dirOfKind(ns.kind), ns.dir);
    assert.equal(entityKindOfDir(`${ns.dir}/thing/index.md`), ns.kind);
    assert.ok(isEntityNamespaceDir(ns.dir));
  }

  // subspaces/ is a folder, not a kind: nothing is filed there by a directory
  // node, so it is not an entity namespace. settings/ is not a namespace at
  // all any more — a space's settings live in Settings, not in a folder.
  assert.equal(entityKindOfDir('subspaces/other/index.md'), null);
  assert.equal(namespaceOf('settings/anything.md'), null);
});

test('namespaceOf: the folder itself and what is under it, nothing that merely starts with it', () => {
  assert.equal(namespaceOf('channels')?.dir, 'channels');
  assert.equal(namespaceOf('channels/general/index.md')?.dir, 'channels');
  assert.equal(namespaceOf('channels-archive/old.md'), null);
  assert.equal(namespaceOf('ops/channels/general.md'), null);
  assert.equal(namespaceOf('notes/q3.md'), null);
  assert.equal(namespaceOf(''), null);
});

test('every folder says what it holds, and spaces/ is the directory records', () => {
  const descriptions = reservedDescriptions();
  for (const ns of RESERVED_NAMESPACES) {
    assert.equal(descriptions[ns.dir], ns.description);
    assert.ok(ns.description.trim().length > 0);
  }
  // spaces/ carried the sub-space flow-up sentence for a while, which belongs
  // to subspaces/. They are different folders and say different things.
  assert.match(descriptions.spaces, /organisations/i);
  assert.match(descriptions.subspaces, /sub-spaces/i);
  assert.notEqual(descriptions.spaces, descriptions.subspaces);
});

test('a folder is there because a tool brings it, and the directory brings the defaults', () => {
  const owner = Object.fromEntries(RESERVED_NAMESPACES.map((ns) => [ns.dir, ns.feature]));

  // What a new space starts with, it starts with because the DIRECTORY is in
  // every space. Each of these is a directory surface: people, orgs and events
  // are its records, the Drive is one of its tabs, an agent and a connector are
  // nodes you open in it, and a model is what an agent record runs on.
  for (const dir of ['people', 'spaces', 'events', 'resources', 'agents', 'connectors', 'models', 'tools']) {
    assert.equal(owner[dir], 'directory', `${dir} belongs to the directory`);
  }

  // A toggleable tool brings its own folders in and out with it. Switching
  // Channels on is what gives a space channels/ and sections/.
  assert.equal(owner.channels, 'channels');
  assert.equal(owner.sections, 'channels');

  // subspaces/ is the only name belonging to no tool — it is no space's own
  // folder at all, but another space's context grafted in at read time.
  assert.deepEqual(
    RESERVED_NAMESPACES.filter((ns) => ns.feature === null).map((ns) => ns.dir),
    ['subspaces', 'parent'],
  );
});

test('the tool gate answers for a switched-off tool only', () => {
  const off = { enabled: { channels: false } };
  const on = { enabled: { channels: true } };

  // Channels is the only toggleable key today, so channels/ and sections/ are
  // the only namespaces a space can be without.
  assert.equal(togglableNamespaceFeature('channels/general/index.md', off), 'channels');
  assert.equal(togglableNamespaceFeature('sections/team.md', off), 'channels');
  assert.equal(togglableNamespaceFeature('channels/general/index.md', on), null);

  // A core feature is never off, so a gate on one could never fire — answering
  // with it would be a refusal that cannot happen, dressed as one that can.
  for (const path of ['people/craig/index.md', 'agents/digest/index.md', 'connectors/slack.md', 'tools/x/index.md']) {
    assert.equal(togglableNamespaceFeature(path, off), null);
  }

  // An ordinary folder belongs to no tool.
  assert.equal(togglableNamespaceFeature('notes/q3/plan.md', off), null);

  // No config at all reads as everything on — isFeatureEnabled's rule for a key
  // nobody has stored an answer for. Both space-creation paths write
  // defaultFeatureConfig(), which says channels: false, so a real space is the
  // `off` case above; this is the one that has no config to read.
  assert.equal(togglableNamespaceFeature('channels/general/index.md', null), null);
});

test('a new space has its folders because its tools do, not because a note made them', () => {
  // Every namespace of a tool the space runs stands. subspaces/ is the only
  // derived one left, and only because no write of this space's ever makes it:
  // federation grafts it when there is a public sub-space to graft.
  assert.deepEqual(
    RESERVED_NAMESPACES.filter((ns) => ns.appearance === 'derived').map((ns) => ns.dir),
    ['subspaces', 'parent'],
  );

  // A fresh space, as its creator (an admin) sees it: the directory's eight,
  // and no channels/ or sections/ because Channels is off by default.
  const fresh = { enabled: { channels: false } };
  assert.deepEqual(standingFolders(fresh, { isAdmin: true }), [
    'people',
    'spaces',
    'events',
    'resources',
    'agents',
    'connectors',
    'models',
    'tools',
  ]);

  // The same space to a member: the two they cannot write are not there while
  // empty, and the moment either holds a note the tree route grafts it from
  // contextFolder like any other folder.
  assert.deepEqual(standingFolders(fresh, { isAdmin: false }), [
    'people',
    'spaces',
    'events',
    'resources',
    'agents',
    'tools',
  ]);

  // Switching Channels on is what brings its two folders, and they are
  // admin-only while empty for the same reason connectors/ is.
  const withChannels = { enabled: { channels: true } };
  assert.ok(standingFolders(withChannels, { isAdmin: true }).includes('channels'));
  assert.ok(standingFolders(withChannels, { isAdmin: true }).includes('sections'));
  assert.ok(!standingFolders(withChannels, { isAdmin: false }).includes('channels'));

  // Nothing stands that the table does not own — subspaces/ above all, which a
  // space must never be handed a way to write into.
  for (const admin of [true, false]) {
    assert.ok(!standingFolders(null, { isAdmin: admin }).includes('subspaces'));
  }
});

test('freeze, do not strand: the refusal is for a namespace holding nothing', () => {
  const off = { enabled: { channels: false } };

  // Nothing there yet, tool off: the space does not get the namespace.
  assert.match(
    String(namespaceFeatureRefusal('channels/general/index.md', off, false)),
    /switched off/,
  );
  // The bare folder is the same answer — that is the path that could conjure a
  // namespace with no note in it at all.
  assert.ok(namespaceFeatureRefusal('channels', off, false));

  // The space HAS channels and then switched the tool off: every note stays
  // openable, editable and renamable. A rename inside the folder is a new
  // destination path with nothing at it, which is exactly why the predicate is
  // "does the namespace hold anything" and not "is this path new".
  assert.equal(namespaceFeatureRefusal('channels/general/index.md', off, true), null);
  assert.equal(namespaceFeatureRefusal('channels/renamed/index.md', off, true), null);

  // Tool on: nothing to say, empty or not.
  assert.equal(namespaceFeatureRefusal('channels/general/index.md', { enabled: { channels: true } }, false), null);

  // A namespace no toggleable tool owns is never refused, however empty.
  assert.equal(namespaceFeatureRefusal('agents/digest/index.md', off, false), null);
  assert.equal(namespaceFeatureRefusal('notes/q3/plan.md', off, false), null);
});
