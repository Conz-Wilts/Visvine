import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_FEATURE_KEYS,
  CORE_FEATURE_KEYS,
  NAV_HIDDEN_FEATURE_KEYS,
  isFeatureEnabled,
  isDirectoryPrivate,
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
    assert.equal(isFeatureEnabled({ enabled: { events: false } }, 'events'), false);
    assert.equal(isFeatureEnabled({ enabled: { events: true } }, 'events'), true);
  });

  it('keeps the directory on even when the config says false', () => {
    assert.equal(isFeatureEnabled({ enabled: { directory: false } }, 'directory'), true);
  });

  it('lists directory, messages and notes as the core features', () => {
    assert.deepEqual(CORE_FEATURE_KEYS, ['directory', 'messages', 'notes']);
  });

  it('hides messages and notes from the nav rail and console toggles', () => {
    assert.deepEqual(NAV_HIDDEN_FEATURE_KEYS, ['messages', 'notes']);
    // notes ("Context") is now core: surfaced as the Context tab under the
    // Directory, always on, and can never be persisted off.
    assert.equal(isFeatureEnabled({ enabled: {} }, 'notes'), true);
    assert.equal(isFeatureEnabled({ enabled: { notes: false } }, 'notes'), true);
    assert.equal(canAccessFeature({ enabled: { notes: false } }, 'notes', false), true);
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
    const config = { enabled: { events: false } };
    assert.equal(canAccessFeature(config, 'events', false), false);
    assert.equal(canAccessFeature(config, 'events', true), false);
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
  const NAV = ['directory', 'channels', 'events', 'resources'];

  it('leaves the registry order alone when no order is configured', () => {
    assert.deepEqual(sortFeatureKeys(null, NAV), NAV);
    assert.deepEqual(sortFeatureKeys({}, NAV), NAV);
    assert.deepEqual(sortFeatureKeys({ order: [] }, NAV), NAV);
  });

  it('applies a full configured order', () => {
    const order = ['events', 'resources', 'directory', 'channels'];
    assert.deepEqual(sortFeatureKeys({ order }, NAV), order);
  });

  it('puts listed keys first and keeps the rest in registry order behind them', () => {
    assert.deepEqual(sortFeatureKeys({ order: ['events'] }, NAV), [
      'events', 'directory', 'channels', 'resources',
    ]);
  });

  it('ignores ordered keys the caller did not ask for', () => {
    // `notes` is a real key but not in this (already-filtered) nav list, and
    // `bogus` is not a key at all — neither may appear in the output.
    assert.deepEqual(sortFeatureKeys({ order: ['notes', 'bogus', 'events'] }, NAV), [
      'events', 'directory', 'channels', 'resources',
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
    assert.deepEqual(sortFeatureKeys({ order: ['events', 'directory'] }, ['directory', 'channels']), [
      'directory', 'channels',
    ]);
  });
});

describe('sanitizeFeatureConfig', () => {
  it('strips core features from enabled so directory can never be persisted off', () => {
    const out = sanitizeFeatureConfig({ enabled: { directory: false, events: false, notes: true } });
    assert.deepEqual(out.enabled, { events: false });
  });

  it('keeps directoryPrivate only when it is a boolean', () => {
    assert.equal(sanitizeFeatureConfig({ directoryPrivate: true }).directoryPrivate, true);
    assert.equal(sanitizeFeatureConfig({ directoryPrivate: false }).directoryPrivate, false);
    assert.equal('directoryPrivate' in sanitizeFeatureConfig({ directoryPrivate: 'yes' as never }), false);
    assert.equal('directoryPrivate' in sanitizeFeatureConfig({}), false);
  });

  it('drops unknown top-level keys', () => {
    const out = sanitizeFeatureConfig({ enabled: { events: true }, extra: 1 } as never);
    assert.deepEqual(Object.keys(out).sort(), ['enabled']);
  });

  it('keeps a valid order', () => {
    const order = ['events', 'directory', 'channels'];
    assert.deepEqual(sanitizeFeatureConfig({ order }).order, order);
  });

  it('strips unknown and duplicate keys from order, keeping first occurrence', () => {
    assert.deepEqual(
      sanitizeFeatureConfig({ order: ['events', 'bogus', 'events', 'directory'] }).order,
      ['events', 'directory'],
    );
  });

  it('omits order when it is absent, not an array, or has nothing usable left', () => {
    assert.equal('order' in sanitizeFeatureConfig({}), false);
    assert.equal('order' in sanitizeFeatureConfig({ order: 'events' }), false);
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
      sanitizeFeatureConfig({ more: ['events', 'bogus', 'events', 'messages', 'resources'] }).more,
      ['events', 'resources'],
    );
  });

  it('omits more when it is absent, not an array, or has nothing usable left', () => {
    assert.equal('more' in sanitizeFeatureConfig({}), false);
    assert.equal('more' in sanitizeFeatureConfig({ more: 'events' }), false);
    assert.equal('more' in sanitizeFeatureConfig({ more: [] }), false);
    assert.equal('more' in sanitizeFeatureConfig({ more: [1, null, 'bogus', 'messages'] }), false);
  });

  it('keeps core and disabled feature keys in more — placement, not enablement', () => {
    // A disabled tool keeps its More slot for when it's re-enabled, and core
    // `directory` may be tucked away just like any other rail item.
    assert.deepEqual(
      sanitizeFeatureConfig({ enabled: { events: false }, more: ['events', 'directory'] }).more,
      ['events', 'directory'],
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
      moreFeatureKeys({ more: ['events', 'bogus', 'events', 'messages', 'notes'] }),
      ['events'],
    );
  });

  it('keeps a disabled feature key — enablement is filtered by the caller', () => {
    assert.deepEqual(
      moreFeatureKeys({ enabled: { events: false }, more: ['events'] }),
      ['events'],
    );
  });
});
