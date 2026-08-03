import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
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
} from '../lib/featureAccess';

// The registry keys from lib/features.tsx — mirrored in featureAccess.ts so the
// node test runner never has to evaluate that module's JSX icons.
const ALL_KEYS = ALL_FEATURE_KEYS;

describe('isFeatureEnabled', () => {
  it('defaults every feature on with an empty/missing config', () => {
    for (const key of ALL_KEYS) {
      assert.equal(isFeatureEnabled(null, key), true);
      assert.equal(isFeatureEnabled({}, key), true);
    }
  });

  it('turns a non-core feature off when explicitly false', () => {
    assert.equal(isFeatureEnabled({ enabled: { tasks: false } }, 'tasks'), false);
    assert.equal(isFeatureEnabled({ enabled: { tasks: true } }, 'tasks'), true);
  });

  it('keeps the directory on even when the config says false', () => {
    assert.equal(isFeatureEnabled({ enabled: { directory: false } }, 'directory'), true);
  });

  it('lists directory, messages, notes and events as the core features', () => {
    assert.deepEqual(CORE_FEATURE_KEYS, ['directory', 'messages', 'notes', 'events']);
  });

  it('hides messages, notes and events from the nav rail and console toggles', () => {
    assert.deepEqual(NAV_HIDDEN_FEATURE_KEYS, ['messages', 'notes', 'events']);
    // notes ("Context") is core: surfaced as the Context tab under the
    // Directory, always on, and can never be persisted off.
    assert.equal(isFeatureEnabled({ enabled: {} }, 'notes'), true);
    assert.equal(isFeatureEnabled({ enabled: { notes: false } }, 'notes'), true);
    assert.equal(canAccessFeature({ enabled: { notes: false } }, 'notes', false), true);
    // events is core too: it's reached from the navbar calendar button, so a
    // stale `enabled.events: false` from before the move must not switch it off.
    assert.equal(isFeatureEnabled({ enabled: { events: false } }, 'events'), true);
    assert.equal(canAccessFeature({ enabled: { events: false } }, 'events', false), true);
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
    const config = { enabled: { tasks: false } };
    assert.equal(canAccessFeature(config, 'tasks', false), false);
    assert.equal(canAccessFeature(config, 'tasks', true), false);
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
    for (const key of ALL_KEYS.filter((k) => k !== 'directory')) {
      assert.equal(canAccessFeature(config, key, false), true);
    }
  });

  it('gives a member with an empty config access to everything', () => {
    for (const key of ALL_KEYS) {
      assert.equal(canAccessFeature(null, key, false), true);
    }
  });
});

describe('sortFeatureKeys', () => {
  const NAV = ['directory', 'channels', 'tasks', 'resources'];

  it('leaves the registry order alone when no order is configured', () => {
    assert.deepEqual(sortFeatureKeys(null, NAV), NAV);
    assert.deepEqual(sortFeatureKeys({}, NAV), NAV);
    assert.deepEqual(sortFeatureKeys({ order: [] }, NAV), NAV);
  });

  it('applies a full configured order', () => {
    const order = ['tasks', 'resources', 'directory', 'channels'];
    assert.deepEqual(sortFeatureKeys({ order }, NAV), order);
  });

  it('puts listed keys first and keeps the rest in registry order behind them', () => {
    assert.deepEqual(sortFeatureKeys({ order: ['tasks'] }, NAV), [
      'tasks', 'directory', 'channels', 'resources',
    ]);
  });

  it('ignores ordered keys the caller did not ask for', () => {
    // `notes` is a real key but not in this (already-filtered) nav list, and
    // `bogus` is not a key at all — neither may appear in the output.
    assert.deepEqual(sortFeatureKeys({ order: ['notes', 'bogus', 'tasks'] }, NAV), [
      'tasks', 'directory', 'channels', 'resources',
    ]);
  });

  it('does not mutate the input list', () => {
    const keys = [...NAV];
    sortFeatureKeys({ order: ['resources'] }, keys);
    assert.deepEqual(keys, NAV);
  });

  it('drops a key from the output when it is filtered out upstream', () => {
    // A disabled feature never reaches sortFeatureKeys, so a stale order entry
    // for it must not resurrect it.
    assert.deepEqual(sortFeatureKeys({ order: ['tasks', 'directory'] }, ['directory', 'channels']), [
      'directory', 'channels',
    ]);
  });
});

describe('sanitizeFeatureConfig', () => {
  it('strips core features from enabled so directory can never be persisted off', () => {
    const out = sanitizeFeatureConfig({ enabled: { directory: false, tasks: false, notes: true } });
    assert.deepEqual(out.enabled, { tasks: false });
  });

  it('keeps directoryPrivate only when it is a boolean', () => {
    assert.equal(sanitizeFeatureConfig({ directoryPrivate: true }).directoryPrivate, true);
    assert.equal(sanitizeFeatureConfig({ directoryPrivate: false }).directoryPrivate, false);
    assert.equal('directoryPrivate' in sanitizeFeatureConfig({ directoryPrivate: 'yes' as never }), false);
    assert.equal('directoryPrivate' in sanitizeFeatureConfig({}), false);
  });

  it('drops unknown top-level keys', () => {
    const out = sanitizeFeatureConfig({ enabled: { tasks: true }, extra: 1 } as never);
    assert.deepEqual(Object.keys(out).sort(), ['enabled']);
  });

  it('keeps a valid order', () => {
    const order = ['tasks', 'directory', 'channels'];
    assert.deepEqual(sanitizeFeatureConfig({ order }).order, order);
  });

  it('strips unknown and duplicate keys from order, keeping first occurrence', () => {
    assert.deepEqual(
      sanitizeFeatureConfig({ order: ['tasks', 'bogus', 'tasks', 'directory'] }).order,
      ['tasks', 'directory'],
    );
  });

  it('omits order when it is absent, not an array, or has nothing usable left', () => {
    assert.equal('order' in sanitizeFeatureConfig({}), false);
    assert.equal('order' in sanitizeFeatureConfig({ order: 'tasks' }), false);
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
      sanitizeFeatureConfig({ more: ['tasks', 'bogus', 'tasks', 'messages', 'resources'] }).more,
      ['tasks', 'resources'],
    );
  });

  it('omits more when it is absent, not an array, or has nothing usable left', () => {
    assert.equal('more' in sanitizeFeatureConfig({}), false);
    assert.equal('more' in sanitizeFeatureConfig({ more: 'tasks' }), false);
    assert.equal('more' in sanitizeFeatureConfig({ more: [] }), false);
    assert.equal('more' in sanitizeFeatureConfig({ more: [1, null, 'bogus', 'messages'] }), false);
  });

  it('keeps core and disabled feature keys in more — placement, not enablement', () => {
    // A disabled tool keeps its More slot for when it's re-enabled, and core
    // `directory` may be tucked away just like any other rail item.
    assert.deepEqual(
      sanitizeFeatureConfig({ enabled: { tasks: false }, more: ['tasks', 'directory'] }).more,
      ['tasks', 'directory'],
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
    // messages and notes are nav-hidden, so neither can live in "More".
    assert.deepEqual(
      moreFeatureKeys({ more: ['tasks', 'bogus', 'tasks', 'messages', 'notes'] }),
      ['tasks'],
    );
  });

  it('keeps a disabled feature key — enablement is filtered by the caller', () => {
    assert.deepEqual(
      moreFeatureKeys({ enabled: { tasks: false }, more: ['tasks'] }),
      ['tasks'],
    );
  });
});

describe('isNodeTypeEnabled', () => {
  it('leaves ungated types alone', () => {
    for (const type of ['Person', 'Community', 'Event', 'Note', 'File', 'Connector']) {
      assert.equal(nodeTypeFeatureKey(type), null);
      assert.equal(isNodeTypeEnabled({ enabled: { channels: false, resources: false } }, type), true);
    }
  });

  it('hides Channel and Space when the channels tool is off', () => {
    const off = { enabled: { channels: false } };
    assert.equal(isNodeTypeEnabled(off, 'Channel'), false);
    assert.equal(isNodeTypeEnabled(off, 'Space'), false);
    // Stored node.type casing drifts — match case-insensitively.
    assert.equal(isNodeTypeEnabled(off, 'space'), false);
    assert.equal(isNodeTypeEnabled({ enabled: { channels: true } }, 'Channel'), true);
  });

  it('hides Resource when the resources tool is off, and defaults everything on', () => {
    assert.equal(isNodeTypeEnabled({ enabled: { resources: false } }, 'Resource'), false);
    assert.equal(isNodeTypeEnabled(null, 'Resource'), true);
    assert.equal(isNodeTypeEnabled({}, 'Channel'), true);
  });
});

describe('adminOnlyFeatureKeys', () => {
  it('folds the legacy directoryPrivate flag in', () => {
    assert.deepEqual(adminOnlyFeatureKeys({ directoryPrivate: true }), ['directory']);
    assert.deepEqual(adminOnlyFeatureKeys({ adminOnly: ['directory'], directoryPrivate: true }), ['directory']);
    assert.deepEqual(adminOnlyFeatureKeys({}), []);
  });

  it('drops unknown, nav-hidden and repeated keys', () => {
    assert.deepEqual(
      adminOnlyFeatureKeys({ adminOnly: ['tasks', 'tasks', 'messages', 'nope', 42 as never] }),
      ['tasks'],
    );
  });

  it('hides an admins-only tool from members, not from admins', () => {
    const config = { adminOnly: ['tasks'] };
    assert.equal(isFeatureAdminOnly(config, 'tasks'), true);
    assert.equal(canAccessFeature(config, 'tasks', false), false);
    assert.equal(canAccessFeature(config, 'tasks', true), true);
    assert.equal(canAccessFeature(config, 'channels', false), true);
  });
});

describe('sanitizeFeatureConfig adminOnly', () => {
  it('keeps directoryPrivate in step with adminOnly', () => {
    assert.equal(sanitizeFeatureConfig({ adminOnly: ['directory'] }).directoryPrivate, true);
    assert.equal(sanitizeFeatureConfig({ adminOnly: ['tasks'] }).directoryPrivate, false);
    // An adminOnly-less save leaves the legacy flag exactly as it was sent.
    assert.equal(sanitizeFeatureConfig({ directoryPrivate: true }).directoryPrivate, true);
  });

  it('reduces adminOnly to known, nav-bearing keys', () => {
    assert.deepEqual(sanitizeFeatureConfig({ adminOnly: ['tasks', 'events', 'bogus'] }).adminOnly, ['tasks']);
    assert.equal('adminOnly' in sanitizeFeatureConfig({}), false);
  });
});

describe('featureNodeTypeNames', () => {
  it('names the types a tool carries in and out with it', () => {
    assert.deepEqual(featureNodeTypeNames('channels'), ['Space', 'Channel']);
    assert.deepEqual(featureNodeTypeNames('resources'), ['Resource']);
  });

  it('is empty for tools that own no node type', () => {
    assert.deepEqual(featureNodeTypeNames('tasks'), []);
    assert.deepEqual(featureNodeTypeNames('directory'), []);
  });
});
