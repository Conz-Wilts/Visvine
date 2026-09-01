import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_ONLY_FEATURE_KEYS,
  ALL_FEATURE_KEYS,
  CORE_FEATURE_KEYS,
  NAV_HIDDEN_FEATURE_KEYS,
  isFeatureEnabled,
  featureNodeTypeNames,
  isNodeTypeEnabled,
  nodeTypeFeatureKey,
  isDirectoryPrivate,
  adminOnlyFeatureKeys,
  isFeatureAdminOnly,
  canAccessFeature,
  moreFeatureKeys,
  sortFeatureKeys,
  sanitizeFeatureConfig,
  mergeFeatureConfig,
} from '../lib/featureAccess';

// The registry keys from lib/features.tsx — mirrored in featureAccess.ts so the
// node test runner never has to evaluate that module's JSX icons.
const ALL_KEYS = ALL_FEATURE_KEYS;
// The keys a member can reach with an empty config — everything except the tools
// that are admins-only whatever the space says (ADMIN_ONLY_FEATURE_KEYS).
const OPEN_KEYS = ALL_FEATURE_KEYS.filter((k) => !ADMIN_ONLY_FEATURE_KEYS.includes(k));

describe('isFeatureEnabled', () => {
  it('defaults every feature on with an empty/missing config', () => {
    for (const key of ALL_KEYS) {
      assert.equal(isFeatureEnabled(null, key), true);
      assert.equal(isFeatureEnabled({}, key), true);
    }
  });

  it('turns a non-core feature off when explicitly false', () => {
    assert.equal(isFeatureEnabled({ enabled: { channels: false } }, 'channels'), false);
    assert.equal(isFeatureEnabled({ enabled: { channels: true } }, 'channels'), true);
  });

  it('keeps the directory on even when the config says false', () => {
    assert.equal(isFeatureEnabled({ enabled: { directory: false } }, 'directory'), true);
  });

  it('lists directory, notes, resources, connectors and tools as the core features', () => {
    // tools is core: the marketplace has no switch — what a space runs is
    // decided by review + install. See tools-feature-keys.test.ts. connectors is
    // core for the same reason: its surface is a console section, admins only.
    // resources is core too: it is a tab of the Directory, not a tool.
    assert.deepEqual(CORE_FEATURE_KEYS, ['directory', 'notes', 'resources', 'connectors', 'tools']);
  });

  it('hides notes, resources, connectors and tools from the nav rail and console toggles', () => {
    // All four are core and nav-hidden: notes is a Directory tab, connectors a
    // Space Console section, tools behind the marketplace icon and per-install
    // `tool:<slug>` rows. Events is NOT here: it is a tool with a rail row.
    assert.deepEqual(NAV_HIDDEN_FEATURE_KEYS, ['notes', 'resources', 'connectors', 'tools']);
    // Agents is not a feature key at all: an agent is a note under `agents/`,
    // watched on its own node page's Agent tab — there is no agents surface to
    // switch on, off or hide.
    assert.equal(ALL_FEATURE_KEYS.includes('agents'), false);
    // resources is core: a space that switched the old Resources tool off keeps
    // its Drive — it is a Directory tab now.
    assert.equal(isFeatureEnabled({ enabled: { resources: false } }, 'resources'), true);
    // connectors is core: a stale `enabled.connectors: false` from before the
    // move must not switch it off — but it stays admins only.
    assert.equal(isFeatureEnabled({ enabled: { connectors: false } }, 'connectors'), true);
    assert.equal(canAccessFeature({ enabled: { connectors: false } }, 'connectors', true), true);
    assert.equal(canAccessFeature(null, 'connectors', false), false);
    // notes ("Context") is core: surfaced as the Context tab under the
    // Directory, always on, and can never be persisted off.
    assert.equal(isFeatureEnabled({ enabled: {} }, 'notes'), true);
    assert.equal(isFeatureEnabled({ enabled: { notes: false } }, 'notes'), true);
    assert.equal(canAccessFeature({ enabled: { notes: false } }, 'notes', false), true);
    // events is not a tool: it is not in the registry at all, and a stale
    // `enabled.events: false` gates nothing.
    assert.equal(ALL_FEATURE_KEYS.includes('events'), false);
    // channels is a toggleable tool: switching it off closes the surface.
    assert.equal(isFeatureEnabled({ enabled: { channels: false } }, 'channels'), false);
    assert.equal(canAccessFeature({ enabled: { channels: false } }, 'channels', false), false);
  });
});

describe('isDirectoryPrivate', () => {
  it('is false unless directoryPrivate is exactly true', () => {
    assert.equal(isDirectoryPrivate(null), false);
    assert.equal(isDirectoryPrivate({}), false);
    assert.equal(isDirectoryPrivate({ directoryPrivate: false }), false);
    assert.equal(isDirectoryPrivate({ directoryPrivate: true }), true);
  });
});

describe('canAccessFeature', () => {
  it('blocks a disabled feature for everyone', () => {
    const config = { enabled: { channels: false } };
    assert.equal(canAccessFeature(config, 'channels', false), false);
    assert.equal(canAccessFeature(config, 'channels', true), false);
  });

  it('hides a private directory from members but not admins', () => {
    const config = { directoryPrivate: true };
    assert.equal(canAccessFeature(config, 'directory', false), false);
    assert.equal(canAccessFeature(config, 'directory', true), true);
  });

  it('leaves the directory open when not private', () => {
    assert.equal(canAccessFeature({}, 'directory', false), true);
    assert.equal(canAccessFeature({ directoryPrivate: false }, 'directory', false), true);
  });

  it('does not let directoryPrivate affect other features', () => {
    const config = { directoryPrivate: true };
    for (const key of OPEN_KEYS.filter((k) => k !== 'directory')) {
      assert.equal(canAccessFeature(config, key, false), true);
    }
  });

  it('gives a member with an empty config access to everything but the locked tools', () => {
    for (const key of OPEN_KEYS) {
      assert.equal(canAccessFeature(null, key, false), true);
    }
    for (const key of ADMIN_ONLY_FEATURE_KEYS) {
      assert.equal(canAccessFeature(null, key, false), false);
      assert.equal(canAccessFeature(null, key, true), true);
    }
  });
});

describe('sortFeatureKeys', () => {
  // An installed Tool's row stands in as the second placeable row: channels is
  // the only toggleable built-in left, so a tool key is what a rail with more
  // than two rows really holds.
  const NAV = ['directory', 'channels', 'tool:kanban'];

  it('leaves the registry order alone when no order is configured', () => {
    assert.deepEqual(sortFeatureKeys(null, NAV), NAV);
    assert.deepEqual(sortFeatureKeys({}, NAV), NAV);
    assert.deepEqual(sortFeatureKeys({ order: [] }, NAV), NAV);
  });

  it('applies a full configured order', () => {
    const order = ['tool:kanban', 'directory', 'channels'];
    assert.deepEqual(sortFeatureKeys({ order }, NAV), order);
  });

  it('puts listed keys first and keeps the rest in registry order behind them', () => {
    assert.deepEqual(sortFeatureKeys({ order: ['tool:kanban'] }, NAV), [
      'tool:kanban', 'directory', 'channels',
    ]);
  });

  it('ignores ordered keys the caller did not ask for', () => {
    // `notes` is a real key but not in this (already-filtered) nav list, and
    // `bogus` is not a key at all — neither may appear in the output.
    assert.deepEqual(sortFeatureKeys({ order: ['notes', 'bogus', 'tool:kanban'] }, NAV), [
      'tool:kanban', 'directory', 'channels',
    ]);
  });

  it('does not mutate the input list', () => {
    const keys = [...NAV];
    sortFeatureKeys({ order: ['tool:kanban'] }, keys);
    assert.deepEqual(keys, NAV);
  });

  it('drops a key from the output when it is filtered out upstream', () => {
    // A disabled feature never reaches sortFeatureKeys, so a stale order entry
    // for it must not resurrect it.
    assert.deepEqual(sortFeatureKeys({ order: ['tool:kanban', 'directory'] }, ['directory', 'channels']), [
      'directory', 'channels',
    ]);
  });
});

describe('sanitizeFeatureConfig', () => {
  it('strips core features from enabled so directory can never be persisted off', () => {
    const out = sanitizeFeatureConfig({ enabled: { directory: false, channels: false, notes: true } });
    assert.deepEqual(out.enabled, { channels: false });
  });

  it('keeps directoryPrivate only when it is a boolean', () => {
    assert.equal(sanitizeFeatureConfig({ directoryPrivate: true }).directoryPrivate, true);
    assert.equal(sanitizeFeatureConfig({ directoryPrivate: false }).directoryPrivate, false);
    assert.equal('directoryPrivate' in sanitizeFeatureConfig({ directoryPrivate: 'yes' as never }), false);
    assert.equal('directoryPrivate' in sanitizeFeatureConfig({}), false);
  });

  it('drops unknown top-level keys', () => {
    const out = sanitizeFeatureConfig({ enabled: { channels: true }, extra: 1 } as never);
    assert.deepEqual(Object.keys(out).sort(), ['enabled']);
  });

  it('keeps a valid order', () => {
    const order = ['tool:kanban', 'directory', 'channels'];
    assert.deepEqual(sanitizeFeatureConfig({ order }).order, order);
  });

  it('strips unknown and duplicate keys from order, keeping first occurrence', () => {
    assert.deepEqual(
      sanitizeFeatureConfig({ order: ['tool:kanban', 'bogus', 'tool:kanban', 'directory'] }).order,
      ['tool:kanban', 'directory'],
    );
  });

  it('omits order when it is absent, not an array, or has nothing usable left', () => {
    assert.equal('order' in sanitizeFeatureConfig({}), false);
    assert.equal('order' in sanitizeFeatureConfig({ order: 'channels' }), false);
    assert.equal('order' in sanitizeFeatureConfig({ order: {} }), false);
    assert.equal('order' in sanitizeFeatureConfig({ order: [] }), false);
    assert.equal('order' in sanitizeFeatureConfig({ order: [1, null, 'bogus'] }), false);
  });

  it('keeps core keys in order — order is about placement, not enablement', () => {
    // `enabled` strips core keys (they can never be off), but a core feature
    // still has to be placeable, so `order` must retain it.
    assert.deepEqual(sanitizeFeatureConfig({ order: ['channels', 'directory'] }).order, [
      'channels', 'directory',
    ]);
  });

  it('keeps a valid more list, dropping unknowns, duplicates and nav-hidden keys', () => {
    assert.deepEqual(
      sanitizeFeatureConfig({ more: ['tool:kanban', 'bogus', 'tool:kanban', 'notes', 'channels'] }).more,
      ['tool:kanban', 'channels'],
    );
  });

  it('omits more when it is absent, not an array, or has nothing usable left', () => {
    assert.equal('more' in sanitizeFeatureConfig({}), false);
    assert.equal('more' in sanitizeFeatureConfig({ more: 'channels' }), false);
    assert.equal('more' in sanitizeFeatureConfig({ more: [] }), false);
    assert.equal('more' in sanitizeFeatureConfig({ more: [1, null, 'bogus', 'notes'] }), false);
  });

  it('keeps core and disabled feature keys in more — placement, not enablement', () => {
    // A disabled tool keeps its More slot for when it's re-enabled, and core
    // `directory` may be tucked away just like any other rail item.
    assert.deepEqual(
      sanitizeFeatureConfig({ enabled: { channels: false }, more: ['channels', 'directory'] }).more,
      ['channels', 'directory'],
    );
  });
});

describe('moreFeatureKeys', () => {
  it('is empty for a missing or empty config', () => {
    assert.deepEqual(moreFeatureKeys(null), []);
    assert.deepEqual(moreFeatureKeys({}), []);
    assert.deepEqual(moreFeatureKeys({ more: [] }), []);
  });

  it('returns the configured keys, dropping unknowns, duplicates and nav-hidden keys', () => {
    // notes is nav-hidden, so it can never live in "More"; channels is a tool
    // with a rail row, so it can. 'events' is no longer a key at all.
    assert.deepEqual(
      moreFeatureKeys({ more: ['channels', 'bogus', 'channels', 'events', 'notes'] }),
      ['channels'],
    );
  });

  it('keeps a disabled feature key — enablement is filtered by the caller', () => {
    assert.deepEqual(
      moreFeatureKeys({ enabled: { channels: false }, more: ['channels'] }),
      ['channels'],
    );
  });
});

describe('isNodeTypeEnabled', () => {
  it('leaves ungated types alone', () => {
    // 'Space' is the org type — always on, like Person.
    for (const type of ['Person', 'Space', 'space', 'Resource']) {
      assert.equal(nodeTypeFeatureKey(type), null);
      assert.equal(isNodeTypeEnabled({ enabled: { channels: false } }, type), true);
    }
  });

  it('never hides Connector — connectors is core', () => {
    // The surface is a console section admins always have, so there is no
    // switch to take the type away with it.
    assert.equal(nodeTypeFeatureKey('Connector'), null);
    assert.equal(isNodeTypeEnabled({ enabled: { connectors: false } }, 'Connector'), true);
    // Stored `node.type` for a connector is lower-case — see notes/entities.ts.
    assert.equal(isNodeTypeEnabled({ enabled: { connectors: false } }, 'connector'), true);
    assert.equal(isNodeTypeEnabled(null, 'Connector'), true);
  });

  it('hides Channel and Section when the channels tool is off', () => {
    const off = { enabled: { channels: false } };
    assert.equal(isNodeTypeEnabled(off, 'Channel'), false);
    assert.equal(isNodeTypeEnabled(off, 'Section'), false);
    // Stored node.type casing drifts — match case-insensitively.
    assert.equal(isNodeTypeEnabled(off, 'section'), false);
    assert.equal(isNodeTypeEnabled({ enabled: { channels: true } }, 'Channel'), true);
  });

  it('never hides Resource — Resources is a tab of the always-on Directory', () => {
    assert.equal(nodeTypeFeatureKey('Resource'), null);
    assert.equal(isNodeTypeEnabled({ enabled: { resources: false } }, 'Resource'), true);
    assert.equal(isNodeTypeEnabled(null, 'Resource'), true);
    assert.equal(isNodeTypeEnabled({}, 'Channel'), true);
  });
});

describe('adminOnlyFeatureKeys', () => {
  it('folds the legacy directoryPrivate flag in', () => {
    assert.deepEqual(adminOnlyFeatureKeys({ directoryPrivate: true }), ['directory', 'connectors']);
    assert.deepEqual(adminOnlyFeatureKeys({ adminOnly: ['directory'], directoryPrivate: true }), ['directory', 'connectors']);
    // Connectors is admins-only by nature, so it's there even with no config.
    assert.deepEqual(adminOnlyFeatureKeys({}), ['connectors']);
  });

  it('drops unknown, nav-hidden and repeated keys', () => {
    assert.deepEqual(
      adminOnlyFeatureKeys({ adminOnly: ['channels', 'channels', 'notes', 'nope', 42 as never] }),
      ['channels', 'connectors'],
    );
  });

  it('hides an admins-only tool from members, not from admins', () => {
    const config = { adminOnly: ['channels'] };
    assert.equal(isFeatureAdminOnly(config, 'channels'), true);
    assert.equal(canAccessFeature(config, 'channels', false), false);
    assert.equal(canAccessFeature(config, 'channels', true), true);
    assert.equal(canAccessFeature(config, 'directory', false), true);
  });
});

describe('sanitizeFeatureConfig adminOnly', () => {
  it('keeps directoryPrivate in step with adminOnly', () => {
    assert.equal(sanitizeFeatureConfig({ adminOnly: ['directory'] }).directoryPrivate, true);
    assert.equal(sanitizeFeatureConfig({ adminOnly: ['channels'] }).directoryPrivate, false);
    // An adminOnly-less save leaves the legacy flag exactly as it was sent.
    assert.equal(sanitizeFeatureConfig({ directoryPrivate: true }).directoryPrivate, true);
  });

  it('reduces adminOnly to known, nav-bearing keys', () => {
    assert.deepEqual(sanitizeFeatureConfig({ adminOnly: ['channels', 'notes', 'bogus'] }).adminOnly, ['channels']);
    assert.equal('adminOnly' in sanitizeFeatureConfig({}), false);
    // The always-admins-only keys are implicit — never written back to the row.
    assert.deepEqual(sanitizeFeatureConfig({ adminOnly: ['connectors'] }).adminOnly, []);
  });
});

// Different console panels write different keys of the same column, so a save
// must inherit the keys it didn't send. These are the exact crossings that used
// to wipe each other when the PUT replaced the column.
describe('mergeFeatureConfig', () => {
  const stored = {
    enabled: { channels: false },
    adminOnly: ['tool:kanban'],
    directoryPrivate: false,
    order: ['tool:kanban', 'channels', 'directory'],
    more: ['tool:kanban'],
  };

  it('keeps the sidebar layout when only adminOnly is sent', () => {
    const merged = mergeFeatureConfig(stored, { adminOnly: ['tool:kanban', 'directory'] });
    assert.deepEqual(merged.enabled, { channels: false });
    assert.deepEqual(merged.order, ['tool:kanban', 'channels', 'directory']);
    assert.deepEqual(merged.more, ['tool:kanban']);
    assert.deepEqual(merged.adminOnly, ['tool:kanban', 'directory']);
    // The legacy flag is re-derived whenever the patch carries adminOnly.
    assert.equal(merged.directoryPrivate, true);
  });

  it('keeps the locks when only the layout is sent', () => {
    const merged = mergeFeatureConfig(
      { ...stored, adminOnly: ['directory'], directoryPrivate: true },
      { enabled: { channels: true }, order: ['directory', 'channels'], more: [] },
    );
    assert.deepEqual(merged.adminOnly, ['directory']);
    assert.equal(merged.directoryPrivate, true);
    assert.deepEqual(merged.enabled, { channels: true });
    assert.deepEqual(merged.order, ['directory', 'channels']);
  });

  it('treats a missing stored config as empty', () => {
    assert.deepEqual(mergeFeatureConfig(null, { adminOnly: ['channels'] }).adminOnly, ['channels']);
    assert.deepEqual(mergeFeatureConfig(undefined, {}), {});
  });

  it('still overwrites the keys a patch does send', () => {
    const merged = mergeFeatureConfig(stored, { adminOnly: [] });
    assert.deepEqual(merged.adminOnly, []);
    assert.equal(merged.directoryPrivate, false);
  });
});

describe('featureNodeTypeNames', () => {
  it('names the types a tool carries in and out with it', () => {
    assert.deepEqual(featureNodeTypeNames('channels'), ['Section', 'Channel']);
    // Resource belongs to the Directory's Resources tab, and Event to the
    // directory itself now that Events is not a tool: nothing switches either off.
    assert.deepEqual(featureNodeTypeNames('resources'), []);
    assert.deepEqual(featureNodeTypeNames('events'), []);

  });

  it('is empty for tools that own no node type', () => {
    // Connectors is core and nav-hidden: it has no console row to name a type on.
    assert.deepEqual(featureNodeTypeNames('connectors'), []);
    assert.deepEqual(featureNodeTypeNames('directory'), []);
  });
});
