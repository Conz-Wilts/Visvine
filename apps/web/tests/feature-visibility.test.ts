import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { visibleNodes, visibleGraph } from '../lib/notes/context/featureVisibility';
import type { SpaceFeatureConfig, NBLink, NBNode } from '../lib/types';

const node = (id: string, type: string): NBNode =>
  ({ id, type, name: id }) as NBNode;

const link = (source: string, target: string): NBLink =>
  ({ source, target, relationship: 'related' }) as NBLink;

const ALL: NBNode[] = [
  node('person:a', 'person'),
  // Legacy id prefixes survive the renames — only the type column migrates.
  node('space:b', 'Space'),
  node('event:c', 'event'),
  // Resource belongs to the Directory's Resources tab — always on, never hidden.
  node('resource:d', 'resource'),
  // Connector is core (the console section), so it is never hidden.
  node('connector:e', 'connector'),
  node('channel:f', 'channel'),
  node('space:g', 'section'),
  // Agent belongs to Context, which is always on, so it is never hidden either.
  node('agent:h', 'agent'),
];

const names = (nodes: NBNode[]) => nodes.map((n) => n.id).sort();

describe('visibleNodes', () => {
  it('keeps everything when no tool is switched off', () => {
    assert.equal(visibleNodes(ALL, null).length, ALL.length);
    assert.equal(visibleNodes(ALL, {}).length, ALL.length);
  });

  it('drops the node types a switched-off tool owns', () => {
    const config: SpaceFeatureConfig = { enabled: { channels: false } };
    assert.deepEqual(
      names(visibleNodes(ALL, config)),
      ['agent:h', 'connector:e', 'event:c', 'person:a', 'resource:d', 'space:b'],
    );
  });

  it('takes both Channel and Section out with the channels tool', () => {
    const config: SpaceFeatureConfig = { enabled: { channels: false } };
    const kept = names(visibleNodes(ALL, config));
    assert.equal(kept.includes('channel:f'), false);
    assert.equal(kept.includes('space:g'), false);
    assert.equal(kept.includes('person:a'), true);
  });

  it('never hides the types core surfaces own', () => {
    // Every toggleable tool off at once (and a stale resources: false from
    // when Resources was a tool) — person, Space, event, resource, connector
    // and agent stay.
    const config: SpaceFeatureConfig = {
      enabled: { resources: false, channels: false },
    };
    assert.deepEqual(
      names(visibleNodes(ALL, config)),
      ['agent:h', 'connector:e', 'event:c', 'person:a', 'resource:d', 'space:b'],
    );
  });

  it('matches type names case-insensitively, as stored casing drifts', () => {
    const config: SpaceFeatureConfig = { enabled: { channels: false } };
    const mixed = [node('c:1', 'Channel'), node('c:2', 'channel')];
    assert.deepEqual(visibleNodes(mixed, config), []);
  });
});

describe('visibleGraph', () => {
  it('drops links whose far end was hidden, and keeps the rest', () => {
    const config: SpaceFeatureConfig = { enabled: { channels: false } };
    const links = [
      link('person:a', 'space:b'), // both survive
      link('person:a', 'channel:f'), // target hidden
      link('channel:f', 'person:a'), // source hidden
    ];
    const graph = visibleGraph(ALL, links, config);
    assert.equal(graph.links.length, 1);
    assert.deepEqual(graph.links[0], links[0]);
  });

  it('leaves the graph whole when nothing is switched off', () => {
    const links = [link('person:a', 'resource:d')];
    const graph = visibleGraph(ALL, links, null);
    assert.equal(graph.nodes.length, ALL.length);
    assert.equal(graph.links.length, 1);
  });

  it('resolves object-shaped link endpoints, not just id strings', () => {
    // d3 mutates links in place, so source/target can arrive as node objects.
    const config: SpaceFeatureConfig = { enabled: { channels: false } };
    const objectLink = { source: 'person:a', target: 'channel:f', relationship: 'related' };
    assert.equal(visibleGraph(ALL, [objectLink as NBLink], config).links.length, 0);
  });
});
