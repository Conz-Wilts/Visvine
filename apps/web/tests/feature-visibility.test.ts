import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { visibleNodes, visibleGraph } from '../lib/notes/context/featureVisibility';
import type { CommunityFeatureConfig, NBLink, NBNode } from '../lib/types';

const node = (id: string, type: string): NBNode =>
  ({ id, type, name: id }) as NBNode;

const link = (source: string, target: string): NBLink =>
  ({ source, target, relationship: 'related' }) as NBLink;

const ALL: NBNode[] = [
  node('person:a', 'person'),
  // Legacy id prefixes survive the renames — only the type column migrates.
  node('community:b', 'Space'),
  node('event:c', 'event'),
  node('resource:d', 'resource'),
  node('connector:e', 'connector'),
  node('channel:f', 'channel'),
  node('space:g', 'section'),
];

const names = (nodes: NBNode[]) => nodes.map((n) => n.id).sort();

describe('visibleNodes', () => {
  it('keeps everything when no tool is switched off', () => {
    assert.equal(visibleNodes(ALL, null).length, ALL.length);
    assert.equal(visibleNodes(ALL, {}).length, ALL.length);
  });

  it('drops the node types a switched-off tool owns', () => {
    const config: CommunityFeatureConfig = { enabled: { connectors: false } };
    assert.deepEqual(
      names(visibleNodes(ALL, config)),
      ['channel:f', 'community:b', 'event:c', 'person:a', 'resource:d', 'space:g'],
    );
  });

  it('takes both Channel and Section out with the channels tool', () => {
    const config: CommunityFeatureConfig = { enabled: { channels: false } };
    const kept = names(visibleNodes(ALL, config));
    assert.equal(kept.includes('channel:f'), false);
    assert.equal(kept.includes('space:g'), false);
    assert.equal(kept.includes('person:a'), true);
  });

  it('never hides the types core surfaces own', () => {
    // Every toggleable tool off at once — person, Space and event stay.
    const config: CommunityFeatureConfig = {
      enabled: { connectors: false, resources: false, channels: false },
    };
    assert.deepEqual(
      names(visibleNodes(ALL, config)),
      ['community:b', 'event:c', 'person:a'],
    );
  });

  it('matches type names case-insensitively, as stored casing drifts', () => {
    const config: CommunityFeatureConfig = { enabled: { resources: false } };
    const mixed = [node('r:1', 'Resource'), node('r:2', 'resource')];
    assert.deepEqual(visibleNodes(mixed, config), []);
  });
});

describe('visibleGraph', () => {
  it('drops links whose far end was hidden, and keeps the rest', () => {
    const config: CommunityFeatureConfig = { enabled: { connectors: false } };
    const links = [
      link('person:a', 'community:b'), // both survive
      link('person:a', 'connector:e'), // target hidden
      link('connector:e', 'person:a'), // source hidden
    ];
    const graph = visibleGraph(ALL, links, config);
    assert.equal(graph.links.length, 1);
    assert.deepEqual(graph.links[0], links[0]);
  });

  it('leaves the graph whole when nothing is switched off', () => {
    const links = [link('person:a', 'connector:e')];
    const graph = visibleGraph(ALL, links, null);
    assert.equal(graph.nodes.length, ALL.length);
    assert.equal(graph.links.length, 1);
  });

  it('resolves object-shaped link endpoints, not just id strings', () => {
    // d3 mutates links in place, so source/target can arrive as node objects.
    const config: CommunityFeatureConfig = { enabled: { connectors: false } };
    const objectLink = { source: 'person:a', target: 'connector:e', relationship: 'related' };
    assert.equal(visibleGraph(ALL, [objectLink as NBLink], config).links.length, 0);
  });
});
