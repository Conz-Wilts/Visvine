import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_FEATURE_KEYS,
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

// The `tools` key is the tool vocabulary (the /tools marketplace + the Tool node
// type); each INSTALLED Tool is a separate, dynamic rail key `tool:<slug>`.
// Everything that persists or orders feature keys has to carry both.

describe('the tools feature key', () => {
  it('is in the registry, nav-hidden, and not admins-only', () => {
    assert.ok(ALL_FEATURE_KEYS.includes('tools'));
    // Reached from the navbar marketplace icon and per-install rail rows — there
    // is never a "Tools" rail row of its own.
    assert.ok(NAV_HIDDEN_FEATURE_KEYS.includes('tools'));
    // Members author tools; only installing and publishing are admin acts.
    assert.equal(ADMIN_ONLY_FEATURE_KEYS.includes('tools'), false);
    assert.equal(canAccessFeature(null, 'tools', false), true);
  });

  it('is toggleable — unlike the other nav-hidden keys, which are core', () => {
    assert.equal(isFeatureEnabled(null, 'tools'), true);
    assert.equal(isFeatureEnabled({ enabled: { tools: false } }, 'tools'), false);
    assert.equal(canAccessFeature({ enabled: { tools: false } }, 'tools', true), false);
  });

  it('gates the Tool node type', () => {
    assert.equal(nodeTypeFeatureKey('Tool'), 'tools');
    // Stored `node.type` for a tool is lower-case — see lib/notes/entities.ts.
    assert.equal(nodeTypeFeatureKey('tool'), 'tools');
    assert.deepEqual(featureNodeTypeNames('tools'), ['Tool']);
    assert.equal(isNodeTypeEnabled({ enabled: { tools: false } }, 'Tool'), false);
    assert.equal(isNodeTypeEnabled({ enabled: { tools: true } }, 'Tool'), true);
    assert.equal(isNodeTypeEnabled(null, 'Tool'), true);
  });

  it('has no sidebar row, so it can be neither locked nor tucked into More', () => {
    assert.deepEqual(adminOnlyFeatureKeys({ adminOnly: ['tools'] }), ['connectors']);
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
    // The registry key is the vocabulary switch, not a rail key.
    assert.equal(isToolRailKey('tools'), false);
    assert.equal(isToolRailKey('tool'), false);
    assert.equal(isToolRailKey('tool:'), false);
    // A slug is one note-folder segment: no slash, no whitespace, no second colon.
    assert.equal(isToolRailKey('tool:a/b'), false);
    assert.equal(isToolRailKey('tool:a b'), false);
    assert.equal(isToolRailKey('tool:a:b'), false);
    assert.equal(isToolRailKey('resources'), false);
    assert.equal(isToolRailKey(42), false);
    assert.equal(isToolRailKey(null), false);
  });
});

describe('sortFeatureKeys with tool rail keys', () => {
  const NAV = ['directory', toolRailKey('kanban'), 'resources'];

  it('leaves them in registry order when nothing is configured', () => {
    assert.deepEqual(sortFeatureKeys(null, NAV), NAV);
  });

  it('orders a tool row among the registry rows', () => {
    const order = [toolRailKey('kanban'), 'resources', 'directory'];
    assert.deepEqual(sortFeatureKeys({ order }, NAV), order);
  });

  it('puts a listed tool row first and keeps the rest behind it', () => {
    assert.deepEqual(sortFeatureKeys({ order: [toolRailKey('kanban')] }, NAV), [
      'tool:kanban', 'directory', 'resources',
    ]);
  });

  it('never resurrects a tool the caller filtered out (uninstalled, disabled)', () => {
    assert.deepEqual(
      sortFeatureKeys({ order: [toolRailKey('gone'), 'directory'] }, ['directory', 'resources']),
      ['directory', 'resources'],
    );
  });
});

describe('moreFeatureKeys with tool rail keys', () => {
  it('tucks a tool row into More like any other rail row', () => {
    assert.deepEqual(moreFeatureKeys({ more: [toolRailKey('kanban')] }), ['tool:kanban']);
    assert.deepEqual(
      moreFeatureKeys({ more: ['resources', toolRailKey('kanban'), toolRailKey('kanban')] }),
      ['resources', 'tool:kanban'],
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
      order: ['directory', toolRailKey('kanban'), 'resources'],
      more: [toolRailKey('kanban')],
      adminOnly: [toolRailKey('kanban')],
    });
    assert.deepEqual(out.order, ['directory', 'tool:kanban', 'resources']);
    assert.deepEqual(out.more, ['tool:kanban']);
    assert.deepEqual(out.adminOnly, ['tool:kanban']);
  });

  it('drops unknown non-tool keys, duplicates and malformed tool keys', () => {
    const out = sanitizeFeatureConfig({
      order: ['bogus', toolRailKey('kanban'), 'tool:', toolRailKey('kanban'), 'resources'],
      more: ['nope', 'tool:a/b', toolRailKey('kanban')],
    });
    assert.deepEqual(out.order, ['tool:kanban', 'resources']);
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
    order: ['directory', 'tool:kanban', 'resources'],
    more: ['tool:kanban'],
    adminOnly: ['tool:kanban'],
  };

  it('inherits the tool rows when the patch only sends enabled', () => {
    const merged = mergeFeatureConfig(stored, { enabled: { tools: true } });
    assert.deepEqual(merged.order, ['directory', 'tool:kanban', 'resources']);
    assert.deepEqual(merged.more, ['tool:kanban']);
    assert.deepEqual(merged.adminOnly, ['tool:kanban']);
    assert.deepEqual(merged.enabled, { channels: false, tools: true });
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
    assert.deepEqual(merged.order, ['directory', 'tool:kanban', 'resources', 'tool:wayfinder']);
  });

  it('treats a missing stored config as empty', () => {
    assert.deepEqual(mergeFeatureConfig(null, { order: [toolRailKey('kanban')] }).order, [
      'tool:kanban',
    ]);
  });
});
