import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_FEATURE_KEYS,
  CORE_FEATURE_KEYS,
  NAV_HIDDEN_FEATURE_KEYS,
  ADMIN_ONLY_FEATURE_KEYS,
  TOOL_RAIL_KEY_PREFIX,
  toolRailKey,
  isToolRailKey,
  adminOnlyFeatureKeys,
  canAccessFeature,
  featureNodeTypeNames,
  isFeatureEnabled,
  isNodeTypeEnabled,
  mergeFeatureConfig,
  moreFeatureKeys,
  nodeTypeFeatureKey,
  sanitizeFeatureConfig,
  sortFeatureKeys,
} from '../lib/featureAccess';

// There is no `tools` key: a Tool is a node of the always-on Directory, and the
// marketplace is gated on `directory` like the rest of it. What a space runs is
// decided by publish + approve + install. Each INSTALLED Tool is a separate,
// dynamic rail key `tool:<slug>` — the one that can actually be switched — and
// everything that persists or orders feature keys has to carry those.

describe('the tool vocabulary has no feature key of its own', () => {
  it('is not in the registry, and is not core', () => {
    assert.equal(ALL_FEATURE_KEYS.includes('tools'), false);
    assert.equal(CORE_FEATURE_KEYS.includes('tools'), false);
    assert.equal(NAV_HIDDEN_FEATURE_KEYS.includes('tools'), false);
    assert.equal(ADMIN_ONLY_FEATURE_KEYS.includes('tools'), false);
  });

  it('rides the directory, which is core and open to members', () => {
    // Members author tools and browse the marketplace; only installing and
    // publishing are admin acts (a member's Install becomes a request).
    assert.equal(canAccessFeature(null, 'directory', false), true);
    assert.equal(isFeatureEnabled({ enabled: { directory: false } }, 'directory'), true);
    // A stale `tools: false` from before the key was removed names nothing —
    // and a fresh sanitize never persists it.
    assert.equal('tools' in (sanitizeFeatureConfig({ enabled: { tools: false } }).enabled ?? {}), false);
  });

  it('never gates the Tool node type — nothing can hide it', () => {
    assert.equal(nodeTypeFeatureKey('Tool'), null);
    assert.equal(nodeTypeFeatureKey('tool'), null);
    assert.deepEqual(featureNodeTypeNames('tools'), []);
    assert.equal(isNodeTypeEnabled({ enabled: { tools: false } }, 'Tool'), true);
    assert.equal(isNodeTypeEnabled(null, 'Tool'), true);
  });

  it('has no sidebar row, so it can be neither locked nor tucked into More', () => {
    assert.deepEqual(adminOnlyFeatureKeys({ adminOnly: ['tools'] }), ['connectors', 'imessage']);
    assert.deepEqual(moreFeatureKeys({ more: ['tools'] }), []);
    assert.equal('more' in sanitizeFeatureConfig({ more: ['tools'] }), false);
  });
});

describe('toolRailKey / isToolRailKey', () => {
  it('builds and recognises a per-install rail key', () => {
    assert.equal(TOOL_RAIL_KEY_PREFIX, 'tool:');
    assert.equal(toolRailKey('deal-pipeline'), 'tool:deal-pipeline');
    assert.ok(isToolRailKey(toolRailKey('deal-pipeline')));
    assert.ok(isToolRailKey('tool:wayfinder'));
    assert.ok(isToolRailKey('tool:Kanban_2'));
  });

  it('rejects anything that is not one', () => {
    // `tools` is the note folder, never a rail key.
    assert.equal(isToolRailKey('tools'), false);
    assert.equal(isToolRailKey('tool'), false);
    assert.equal(isToolRailKey('tool:'), false);
    // A slug is one note-folder segment: no slash, no whitespace, no second colon.
    assert.equal(isToolRailKey('tool:a/b'), false);
    assert.equal(isToolRailKey('tool:a b'), false);
    assert.equal(isToolRailKey('tool:a:b'), false);
    assert.equal(isToolRailKey('channels'), false);
    assert.equal(isToolRailKey(42), false);
    assert.equal(isToolRailKey(null), false);
  });
});

describe('sortFeatureKeys with tool rail keys', () => {
  const NAV = ['directory', toolRailKey('kanban'), 'channels'];

  it('leaves them in registry order when nothing is configured', () => {
    assert.deepEqual(sortFeatureKeys(null, NAV), NAV);
  });

  it('orders a tool row among the registry rows', () => {
    const order = [toolRailKey('kanban'), 'channels', 'directory'];
    assert.deepEqual(sortFeatureKeys({ order }, NAV), order);
  });

  it('puts a listed tool row first and keeps the rest behind it', () => {
    assert.deepEqual(sortFeatureKeys({ order: [toolRailKey('kanban')] }, NAV), [
      'tool:kanban', 'directory', 'channels',
    ]);
  });

  it('never resurrects a tool the caller filtered out (uninstalled, disabled)', () => {
    assert.deepEqual(
      sortFeatureKeys({ order: [toolRailKey('gone'), 'directory'] }, ['directory', 'channels']),
      ['directory', 'channels'],
    );
  });
});

describe('moreFeatureKeys with tool rail keys', () => {
  it('tucks a tool row into More like any other rail row', () => {
    assert.deepEqual(moreFeatureKeys({ more: [toolRailKey('kanban')] }), ['tool:kanban']);
    assert.deepEqual(
      moreFeatureKeys({ more: ['channels', toolRailKey('kanban'), toolRailKey('kanban')] }),
      ['channels', 'tool:kanban'],
    );
  });

  it('still drops junk that only looks like a tool key', () => {
    assert.deepEqual(moreFeatureKeys({ more: ['tool:', 'tool', 'bogus', toolRailKey('ok')] }), [
      'tool:ok',
    ]);
  });
});

describe('sanitizeFeatureConfig with tool rail keys', () => {
  it('persists tool rows in order, more and adminOnly', () => {
    const out = sanitizeFeatureConfig({
      order: ['directory', toolRailKey('kanban'), 'channels'],
      more: [toolRailKey('kanban')],
      adminOnly: [toolRailKey('kanban')],
    });
    assert.deepEqual(out.order, ['directory', 'tool:kanban', 'channels']);
    assert.deepEqual(out.more, ['tool:kanban']);
    assert.deepEqual(out.adminOnly, ['tool:kanban']);
  });

  it('drops unknown non-tool keys, duplicates and malformed tool keys', () => {
    const out = sanitizeFeatureConfig({
      order: ['bogus', toolRailKey('kanban'), 'tool:', toolRailKey('kanban'), 'channels'],
      more: ['nope', 'tool:a/b', toolRailKey('kanban')],
    });
    assert.deepEqual(out.order, ['tool:kanban', 'channels']);
    assert.deepEqual(out.more, ['tool:kanban']);
  });

  it('leaves a tool row locked to admins resolvable', () => {
    const config = sanitizeFeatureConfig({ adminOnly: [toolRailKey('kanban')] });
    assert.equal(canAccessFeature(config, toolRailKey('kanban'), false), false);
    assert.equal(canAccessFeature(config, toolRailKey('kanban'), true), true);
  });
});

// featureConfig is written by more than one console panel, so a save that
// doesn't carry the sidebar layout must inherit it — otherwise installing or
// locking one thing would silently uninstall every Tool row.
describe('mergeFeatureConfig keeps tool rail keys', () => {
  const stored = {
    enabled: { channels: false },
    order: ['directory', 'tool:kanban', 'channels'],
    more: ['tool:kanban'],
    adminOnly: ['tool:kanban'],
  };

  it('inherits the tool rows when the patch only sends enabled', () => {
    const merged = mergeFeatureConfig(stored, { enabled: { 'tool:kanban': true } });
    assert.deepEqual(merged.order, ['directory', 'tool:kanban', 'channels']);
    assert.deepEqual(merged.more, ['tool:kanban']);
    assert.deepEqual(merged.adminOnly, ['tool:kanban']);
    assert.deepEqual(merged.enabled, { channels: false, 'tool:kanban': true });
  });

  it('inherits the tool lock when the patch only sends the layout', () => {
    const merged = mergeFeatureConfig(stored, {
      order: ['tool:kanban', 'directory'],
      more: [],
    });
    assert.deepEqual(merged.order, ['tool:kanban', 'directory']);
    assert.deepEqual(merged.adminOnly, ['tool:kanban']);
    assert.equal('more' in merged, false);
  });

  it('adds a newly installed tool row without losing the existing one', () => {
    const merged = mergeFeatureConfig(stored, {
      order: [...stored.order, toolRailKey('wayfinder')],
    });
    assert.deepEqual(merged.order, ['directory', 'tool:kanban', 'channels', 'tool:wayfinder']);
  });

  it('treats a missing stored config as empty', () => {
    assert.deepEqual(mergeFeatureConfig(null, { order: [toolRailKey('kanban')] }).order, [
      'tool:kanban',
    ]);
  });
});
