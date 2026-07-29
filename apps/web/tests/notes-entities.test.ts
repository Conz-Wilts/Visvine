import test from 'node:test';
import assert from 'node:assert/strict';
import {
  entityKindOf,
  entityNotePath,
  parseEntityHref,
  entityKindOfPath,
  entityDraftContent,
  entityStub,
  resolveEntityNode,
  entityMentionPaths,
} from '../lib/notes/entities';
import { parseFrontmatter } from '../lib/notes/shared/markdown';

test('entityKindOf classifies node types liberally', () => {
  assert.equal(entityKindOf('person'), 'person');
  assert.equal(entityKindOf('Person'), 'person');
  assert.equal(entityKindOf('organization'), 'company');
  assert.equal(entityKindOf('org'), 'company');
  assert.equal(entityKindOf('company'), 'company');
  assert.equal(entityKindOf('resource'), 'resource');
  assert.equal(entityKindOf('Resources'), 'resource');
  assert.equal(entityKindOf('event'), 'event');
  assert.equal(entityKindOf('Events'), 'event');
  assert.equal(entityKindOf('note'), null);
  assert.equal(entityKindOf(''), null);
  assert.equal(entityKindOf(null), null);
});

test('entityKindOf classifies the container kinds', () => {
  assert.equal(entityKindOf('community'), 'community');
  assert.equal(entityKindOf('Communities'), 'community');
  assert.equal(entityKindOf('space'), 'space');
  assert.equal(entityKindOf('Channels'), 'channel');
  // 'community' must not be swallowed by the liberal company branch.
  assert.notEqual(entityKindOf('community'), 'company');
  // Uploaded files are documents, not entities — they never get a note of their own.
  assert.equal(entityKindOf('file'), null);
});

test('container kinds get their own note namespaces', () => {
  assert.equal(entityNotePath({ id: 'community:blackbird', type: 'community' }), 'communities/blackbird.md');
  assert.equal(entityNotePath({ id: 'space:engineering', type: 'space' }), 'spaces/engineering.md');
  assert.equal(entityNotePath({ id: 'channel:general', type: 'channel' }), 'channels/general.md');
  assert.equal(entityKindOfPath('communities/blackbird.md'), 'community');
  assert.equal(entityKindOfPath('spaces/engineering.md'), 'space');
  assert.equal(entityKindOfPath('channels/general.md'), 'channel');
  assert.equal(parseEntityHref('/channels/general.md'), 'channels/general.md');
  assert.equal(parseEntityHref('/spaces/index.md'), null); // folder index, not an entity
});

test('entityDraftContent labels and tags the container kinds', () => {
  const md = entityDraftContent(
    { id: 'channel:general', type: 'channel', name: 'general', subtitle: 'Everything else' },
    { tags: ['ops'], body: 'Where announcements land.' },
  );
  const fm = parseFrontmatter(md);
  assert.equal(fm.type, 'Channel');
  assert.equal(fm.title, 'general');
  assert.equal(fm.node, 'channel:general');
  assert.deepEqual(fm.tags, ['channel', 'ops']);
  assert.ok(md.includes('Where announcements land.'));
});

test('entityNotePath derives people/ and companies/ paths from the node id', () => {
  assert.equal(entityNotePath({ id: 'person:craig-piggott', type: 'person' }), 'people/craig-piggott.md');
  assert.equal(entityNotePath({ id: 'org:halter', type: 'organization' }), 'companies/halter.md');
  assert.equal(entityNotePath({ id: 'resource:founder-playbook', type: 'resource' }), 'resources/founder-playbook.md');
  assert.equal(entityNotePath({ id: 'event:summit', type: 'event' }), 'events/summit.md');
  // slug comes from the id, not the name (collision-proof)
  assert.equal(entityNotePath({ id: 'person:jane-doe-acme', type: 'person', name: 'Jane Doe' }), 'people/jane-doe-acme.md');
  // non-entity nodes return null
  assert.equal(entityNotePath({ id: 'note:welcome', type: 'note' }), null);
});

test('parseEntityHref normalizes only valid entity hrefs', () => {
  assert.equal(parseEntityHref('/people/craig-piggott.md'), 'people/craig-piggott.md');
  assert.equal(parseEntityHref('companies/halter.md'), 'companies/halter.md');
  assert.equal(parseEntityHref('resources/founder-playbook.md'), 'resources/founder-playbook.md');
  assert.equal(parseEntityHref('/notes/welcome.md'), null);
  assert.equal(parseEntityHref('/people/craig'), null); // missing .md
  assert.equal(parseEntityHref('https://example.com'), null);
  assert.equal(parseEntityHref(''), null);
});

test('parseEntityHref excludes folder index notes', () => {
  assert.equal(parseEntityHref('/people/index.md'), null);
  assert.equal(parseEntityHref('companies/index.md'), null);
  assert.equal(parseEntityHref('resources/index.md'), null);
  assert.equal(parseEntityHref('people/sub/index.md'), null);
  // Only the exact index.md basename is excluded — slugs merely containing it stay entities.
  assert.equal(parseEntityHref('people/index-fund.md'), 'people/index-fund.md');
});

test('entityMentionPaths ignores links to folder indexes', () => {
  const md = 'Back to [Founders](/people/index.md) and [Craig](/people/craig-piggott.md).';
  assert.deepEqual(entityMentionPaths('companies/halter.md', md), ['people/craig-piggott.md']);
});

test('path <-> node id round trips', () => {
  const node = { id: 'person:craig-piggott', type: 'person' };
  const path = entityNotePath(node)!;
  assert.equal(parseEntityHref(`/${path}`), path);
  assert.equal(entityKindOfPath(path), 'person');
  assert.equal(entityKindOfPath('companies/halter.md'), 'company');
  assert.equal(entityKindOfPath('resources/founder-playbook.md'), 'resource');
  assert.equal(entityKindOfPath('notes/welcome.md'), null);
});

test('entityMentionPaths extracts entity-note links from the body only', () => {
  const md =
    '---\ntitle: Halter\nnode: "org:halter"\ntags: [company]\n---\n\n' +
    'Founded by [Craig Piggott](/people/craig-piggott.md). Backed by ' +
    '[Blackbird](https://blackbird.vc) — see [thesis](/notes/thesis.md) and ' +
    '[Craig Piggott](/people/craig-piggott.md) again.\n';
  // External links and non-entity notes are ignored; duplicates collapse.
  assert.deepEqual(entityMentionPaths('companies/halter.md', md), ['people/craig-piggott.md']);
});

test('entityMentionPaths resolves relative links and excludes self-links', () => {
  const md =
    'Peer: [Aquila](aquila.md). Self: [Halter](/companies/halter.md). ' +
    'Person: [Craig](../people/craig-piggott.md).\n';
  assert.deepEqual(entityMentionPaths('companies/halter.md', md), [
    'companies/aquila.md',
    'people/craig-piggott.md',
  ]);
});

test('entityMentionPaths returns [] for notes with no entity mentions', () => {
  assert.deepEqual(entityMentionPaths('companies/halter.md', 'Just prose, no links.'), []);
  assert.deepEqual(entityMentionPaths('notes/welcome.md', '[Craig](/people/craig-piggott.md)'), [
    'people/craig-piggott.md',
  ]); // non-entity notes still extract — the sync layer decides whether to act
});

test('entityStub produces parseable frontmatter carrying the node id', () => {
  const md = entityStub({ id: 'person:craig-piggott', type: 'person', name: 'Craig Piggott', subtitle: 'Founder, Halter' });
  const fm = parseFrontmatter(md);
  assert.equal(fm.type, 'Person');
  assert.equal(fm.title, 'Craig Piggott');
  assert.equal((fm as Record<string, unknown>).node, 'person:craig-piggott');
  assert.deepEqual(fm.tags, ['person']);
  // The title renders from frontmatter, so the body has no duplicate `# Title` heading.
  assert.doesNotMatch(md, /# Craig Piggott/);
  assert.match(md, /Founder, Halter/);
});

test('entityStub covers resource nodes', () => {
  const md = entityStub({ id: 'resource:founder-playbook', type: 'resource', name: 'Founder Playbook' });
  const fm = parseFrontmatter(md);
  assert.equal(fm.type, 'Resource');
  assert.equal(fm.title, 'Founder Playbook');
  assert.deepEqual(fm.tags, ['resource']);
});

test('entityStub escapes tricky names so frontmatter still parses', () => {
  const md = entityStub({ id: 'org:eucalyptus', type: 'organization', name: 'Eucalyptus: telehealth & "more"' });
  const fm = parseFrontmatter(md);
  assert.equal(fm.type, 'Company');
  assert.equal(fm.title, 'Eucalyptus: telehealth & "more"');
  assert.deepEqual(fm.tags, ['company']);
});

test('entityDraftContent keeps the body typed before a type was picked', () => {
  const md = entityDraftContent(
    { id: 'person:craig-piggott', type: 'person', name: 'Craig Piggott' },
    { body: 'Met at the dairy conference. Follow up re: collars.' },
  );
  const fm = parseFrontmatter(md);
  assert.equal(fm.type, 'Person');
  assert.match(md, /Met at the dairy conference/);
  // The stub's placeholder line is replaced, not appended to.
  assert.doesNotMatch(md, /Context and notes about this person/);
});

test('entityDraftContent merges user tags after the kind tag, de-duped', () => {
  const md = entityDraftContent(
    { id: 'person:craig-piggott', type: 'person', name: 'Craig Piggott' },
    { tags: ['Founder', ' agritech ', 'Person', ''] },
  );
  assert.deepEqual(parseFrontmatter(md).tags, ['person', 'Founder', 'agritech']);
});

test('entityDraftContent with no body or tags is exactly the stub', () => {
  const node = { id: 'resource:founder-playbook', type: 'resource', name: 'Founder Playbook' };
  assert.equal(entityDraftContent(node, {}), entityStub(node));
  assert.equal(entityDraftContent(node, { body: '   ', tags: [] }), entityStub(node));
});

test('resolveEntityNode resolves through the node map, never by string surgery', () => {
  // Org ids are NOT uniform ('org:halter' in seeds, 'organization:<slug>' from
  // the create modal), so the same companies/ path can back either id shape —
  // only the map (built by entityNotePath over real nodes) can invert it.
  const seedOrg = { id: 'org:halter', type: 'organization' };
  const modalOrg = { id: 'organization:halter', type: 'Organization' };
  assert.equal(entityNotePath(seedOrg), 'companies/halter.md');
  assert.equal(entityNotePath(modalOrg), 'companies/halter.md');

  const viaSeed = new Map([[entityNotePath(seedOrg)!, { id: seedOrg.id }]]);
  const viaModal = new Map([[entityNotePath(modalOrg)!, { id: modalOrg.id }]]);
  assert.equal(resolveEntityNode('companies/halter.md', viaSeed), 'org:halter');
  assert.equal(resolveEntityNode('companies/halter.md', viaModal), 'organization:halter');

  const people = new Map([['people/craig-piggott.md', { id: 'person:craig-piggott' }]]);
  assert.equal(resolveEntityNode('people/craig-piggott.md', people), 'person:craig-piggott');
  // Entity-shaped path with no node in the map (deleted node / other community /
  // map still loading) → null, so callers fall back to opening in place.
  assert.equal(resolveEntityNode('people/unknown.md', people), null);
  // Non-entity paths are never resolved, whatever the map contains.
  assert.equal(resolveEntityNode('notes/welcome.md', new Map([['notes/welcome.md', { id: 'x' }]])), null);
  // Tolerates a missing map.
  assert.equal(resolveEntityNode('people/craig-piggott.md', null), null);
});
