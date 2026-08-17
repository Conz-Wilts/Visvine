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
  resolveEntityOwner,
  entityMentionPaths,
  entityFlatPath,
  entityFolderPathOf,
  entityIndexPathOf,
  entityNotePaths,
  entityOwnerPathOf,
  isEntityFolderIndex,
  entityKindOfDir,
  entityContextHref,
  hrefForNotePath,
  noteHref,
} from '../lib/notes/entities';
import { isCreatableType } from '../lib/directory/createEntity';
import { parseFrontmatter } from '../lib/notes/shared/markdown';

test('entityKindOf classifies node types liberally', () => {
  assert.equal(entityKindOf('person'), 'person');
  assert.equal(entityKindOf('Person'), 'person');
  assert.equal(entityKindOf('organization'), 'space');
  assert.equal(entityKindOf('org'), 'space');
  assert.equal(entityKindOf('group'), 'space');
  assert.equal(entityKindOf('company'), 'space');
  assert.equal(entityKindOf('resource'), 'resource');
  assert.equal(entityKindOf('Resources'), 'resource');
  assert.equal(entityKindOf('event'), 'event');
  assert.equal(entityKindOf('Events'), 'event');
  assert.equal(entityKindOf('note'), null);
  assert.equal(entityKindOf(''), null);
  assert.equal(entityKindOf(null), null);
});

test('entityKindOf classifies the container kinds', () => {
  // 'space' (and the retired 'space' spelling) is the ORG kind now; the
  // channels container is 'section'.
  assert.equal(entityKindOf('space'), 'space');
  assert.equal(entityKindOf('Spaces'), 'space');
  assert.equal(entityKindOf('space'), 'space');
  assert.equal(entityKindOf('section'), 'section');
  assert.equal(entityKindOf('Sections'), 'section');
  assert.equal(entityKindOf('Channels'), 'channel');
  // Uploaded files are documents, not entities — they never get a note of their own.
  assert.equal(entityKindOf('file'), null);
});

test('container kinds get their own note namespaces (dirs kept their old names)', () => {
  assert.equal(entityNotePath({ id: 'community:blackbird', type: 'space' }), 'communities/blackbird.md');
  assert.equal(entityNotePath({ id: 'space:engineering', type: 'section' }), 'spaces/engineering.md');
  assert.equal(entityNotePath({ id: 'channel:general', type: 'channel' }), 'channels/general.md');
  assert.equal(entityKindOfPath('communities/blackbird.md'), 'space');
  assert.equal(entityKindOfPath('spaces/engineering.md'), 'section');
  assert.equal(entityKindOfPath('channels/general.md'), 'channel');
  assert.equal(parseEntityHref('/channels/general.md'), 'channels/general.md');
  assert.equal(parseEntityHref('/spaces/index.md'), null); // folder index, not an entity
});

test('connectors are an entity namespace, but not a creatable one', () => {
  assert.equal(entityKindOf('connector'), 'connector');
  assert.equal(entityKindOf('Connectors'), 'connector');
  assert.equal(entityNotePath({ id: 'connector:sandbox', type: 'connector' }), 'connectors/sandbox.md');
  assert.equal(entityKindOfPath('connectors/sandbox.md'), 'connector');
  assert.equal(parseEntityHref('/connectors/sandbox.md'), 'connectors/sandbox.md');
  assert.equal(parseEntityHref('connectors/index.md'), null); // folder index, not an entity
  // The note is authored by an admin under the connectors/ write gate — the
  // directory create path must never be a second door to one.
  assert.equal(isCreatableType('connector'), false);
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

test('entityNotePath derives people/ and communities/ paths from the node id', () => {
  assert.equal(entityNotePath({ id: 'person:craig-piggott', type: 'person' }), 'people/craig-piggott.md');
  assert.equal(entityNotePath({ id: 'community:halter', type: 'space' }), 'communities/halter.md');
  // …and every retired organisation spelling lands in the same namespace.
  assert.equal(entityNotePath({ id: 'org:halter', type: 'organization' }), 'communities/halter.md');
  assert.equal(entityNotePath({ id: 'group:halter', type: 'Group' }), 'communities/halter.md');
  assert.equal(entityNotePath({ id: 'resource:founder-playbook', type: 'resource' }), 'resources/founder-playbook.md');
  assert.equal(entityNotePath({ id: 'event:summit', type: 'event' }), 'events/summit.md');
  // slug comes from the id, not the name (collision-proof)
  assert.equal(entityNotePath({ id: 'person:jane-doe-acme', type: 'person', name: 'Jane Doe' }), 'people/jane-doe-acme.md');
  // non-entity nodes return null
  assert.equal(entityNotePath({ id: 'note:welcome', type: 'note' }), null);
});

test('parseEntityHref normalizes only valid entity hrefs', () => {
  assert.equal(parseEntityHref('/people/craig-piggott.md'), 'people/craig-piggott.md');
  assert.equal(parseEntityHref('communities/halter.md'), 'communities/halter.md');
  assert.equal(parseEntityHref('resources/founder-playbook.md'), 'resources/founder-playbook.md');
  assert.equal(parseEntityHref('/notes/welcome.md'), null);
  assert.equal(parseEntityHref('/people/craig'), null); // missing .md
  assert.equal(parseEntityHref('https://example.com'), null);
  assert.equal(parseEntityHref(''), null);
});

test('parseEntityHref excludes the namespace root indexes', () => {
  assert.equal(parseEntityHref('/people/index.md'), null);
  assert.equal(parseEntityHref('communities/index.md'), null);
  assert.equal(parseEntityHref('resources/index.md'), null);
  // Only the exact index.md basename is excluded — slugs merely containing it stay entities.
  assert.equal(parseEntityHref('people/index-fund.md'), 'people/index-fund.md');
});

test('parseEntityHref accepts the entity-folder form and rejects sub-notes', () => {
  // people/connor/index.md IS the person's note once it has become a folder.
  assert.equal(parseEntityHref('/people/connor/index.md'), 'people/connor/index.md');
  assert.equal(parseEntityHref('communities/halter/index.md'), 'communities/halter/index.md');
  // Notes inside the folder belong to the entity but are not entity notes.
  assert.equal(parseEntityHref('people/connor/sams-comms.md'), null);
  assert.equal(parseEntityHref('people/connor/2026/q1.md'), null);
  assert.equal(parseEntityHref('people/connor/deeper/index.md'), null);
  assert.equal(entityKindOfPath('people/connor/index.md'), 'person');
  assert.equal(entityKindOfPath('people/connor/sams-comms.md'), null);
  assert.equal(entityKindOfDir('people/connor/sams-comms.md'), 'person');
  assert.equal(entityKindOfDir('people/index.md'), 'person');
  assert.equal(isEntityFolderIndex('people/connor/index.md'), true);
  assert.equal(isEntityFolderIndex('people/connor.md'), false);
  assert.equal(isEntityFolderIndex('people/index.md'), false);
});

test('entityOwnerPathOf names the entity folder a sub-note sits in', () => {
  assert.equal(entityOwnerPathOf('people/connor/sams-comms.md'), 'people/connor');
  assert.equal(entityOwnerPathOf('/people/connor/2026/q1.md'), 'people/connor');
  assert.equal(entityOwnerPathOf('communities/halter/board.md'), 'communities/halter');
  assert.equal(entityOwnerPathOf('people/connor/index.md'), null); // the entity note itself
  assert.equal(entityOwnerPathOf('people/connor.md'), null);
  assert.equal(entityOwnerPathOf('people/index.md'), null);
  assert.equal(entityOwnerPathOf('notes/connor/x.md'), null);
});

test('entityNotePath honours a node-recorded entity folder', () => {
  const node = { id: 'person:connor', type: 'person' };
  assert.equal(entityFlatPath(node), 'people/connor.md');
  assert.equal(entityFolderPathOf(node), 'people/connor');
  assert.equal(entityIndexPathOf(node), 'people/connor/index.md');
  assert.deepEqual(entityNotePaths(node), ['people/connor.md', 'people/connor/index.md']);
  assert.equal(entityNotePath(node), 'people/connor.md');
  assert.equal(
    entityNotePath({ ...node, metadata: { notePath: 'people/connor/index.md' } }),
    'people/connor/index.md',
  );
  // A pointer at some other note is ignored — it can only name this node's own index.
  assert.equal(entityNotePath({ ...node, metadata: { notePath: 'people/other/index.md' } }), 'people/connor.md');
  assert.equal(entityNotePath({ ...node, metadata: { notePath: 42 } }), 'people/connor.md');
  assert.deepEqual(entityNotePaths({ id: 'note:x', type: 'note' }), []);
});

test('resolveEntityOwner maps entity notes and sub-notes to their node', () => {
  const map = new Map([
    ['people/connor.md', { id: 'person:connor' }],
    ['people/connor/index.md', { id: 'person:connor' }],
  ]);
  assert.deepEqual(resolveEntityOwner('people/connor.md', map), { id: 'person:connor', subPath: null });
  assert.deepEqual(resolveEntityOwner('people/connor/index.md', map), { id: 'person:connor', subPath: null });
  assert.deepEqual(resolveEntityOwner('people/connor/sams-comms.md', map), {
    id: 'person:connor',
    subPath: 'sams-comms.md',
  });
  assert.deepEqual(resolveEntityOwner('people/connor/2026/q1.md', map), {
    id: 'person:connor',
    subPath: '2026/q1.md',
  });
  assert.equal(resolveEntityOwner('people/nobody/x.md', map), null);
  assert.equal(resolveEntityOwner('notes/x.md', map), null);
});

test('entityContextHref addresses a node Context tab, with or without a sub-note', () => {
  assert.equal(entityContextHref('person:connor'), '/directory/person%3Aconnor?tab=context');
  assert.equal(
    entityContextHref('person:connor', 'sams-comms.md'),
    '/directory/person%3Aconnor?tab=context&note=sams-comms.md',
  );
  // Nested sub-notes and reserved characters survive the URL.
  assert.equal(
    entityContextHref('person:connor', '2026/q1 & q2.md'),
    '/directory/person%3Aconnor?tab=context&note=2026%2Fq1%20%26%20q2.md',
  );
});

test('hrefForNotePath routes entity notes and sub-notes to the profile, everything else to the note view', () => {
  const map = new Map([
    ['people/connor.md', { id: 'person:connor' }],
    ['people/connor/index.md', { id: 'person:connor' }],
  ]);
  assert.equal(hrefForNotePath('people/connor.md', map), entityContextHref('person:connor'));
  assert.equal(hrefForNotePath('people/connor/index.md', map), entityContextHref('person:connor'));
  assert.equal(
    hrefForNotePath('people/connor/sams-comms.md', map),
    entityContextHref('person:connor', 'sams-comms.md'),
  );
  // Not in the map (other space, deleted, still loading) → the plain note view.
  assert.equal(hrefForNotePath('people/nobody.md', map), noteHref('people/nobody.md'));
  assert.equal(hrefForNotePath('people/nobody/x.md', map), noteHref('people/nobody/x.md'));
  assert.equal(hrefForNotePath('sectors/fintech.md', map), noteHref('sectors/fintech.md'));
  assert.equal(hrefForNotePath('people/index.md', map), noteHref('people/index.md'));
});

test('entityMentionPaths ignores links to folder indexes', () => {
  const md = 'Back to [Founders](/people/index.md) and [Craig](/people/craig-piggott.md).';
  assert.deepEqual(entityMentionPaths('communities/halter.md', md), ['people/craig-piggott.md']);
});

test('path <-> node id round trips', () => {
  const node = { id: 'person:craig-piggott', type: 'person' };
  const path = entityNotePath(node)!;
  assert.equal(parseEntityHref(`/${path}`), path);
  assert.equal(entityKindOfPath(path), 'person');
  assert.equal(entityKindOfPath('communities/halter.md'), 'space');
  assert.equal(entityKindOfPath('resources/founder-playbook.md'), 'resource');
  assert.equal(entityKindOfPath('notes/welcome.md'), null);
});

test('entityMentionPaths extracts entity-note links from the body only', () => {
  const md =
    '---\ntitle: Halter\nnode: "community:halter"\ntags: [space]\n---\n\n' +
    'Founded by [Craig Piggott](/people/craig-piggott.md). Backed by ' +
    '[Blackbird](https://blackbird.vc) — see [thesis](/notes/thesis.md) and ' +
    '[Craig Piggott](/people/craig-piggott.md) again.\n';
  // External links and non-entity notes are ignored; duplicates collapse.
  assert.deepEqual(entityMentionPaths('communities/halter.md', md), ['people/craig-piggott.md']);
});

test('entityMentionPaths resolves relative links and excludes self-links', () => {
  const md =
    'Peer: [Aquila](aquila.md). Self: [Halter](/communities/halter.md). ' +
    'Person: [Craig](../people/craig-piggott.md).\n';
  assert.deepEqual(entityMentionPaths('communities/halter.md', md), [
    'communities/aquila.md',
    'people/craig-piggott.md',
  ]);
});

test('entityMentionPaths returns [] for notes with no entity mentions', () => {
  assert.deepEqual(entityMentionPaths('communities/halter.md', 'Just prose, no links.'), []);
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
  // A legacy 'space'-typed node stubs with the NEW label and tag.
  const md = entityStub({ id: 'community:eucalyptus', type: 'space', name: 'Eucalyptus: telehealth & "more"' });
  const fm = parseFrontmatter(md);
  assert.equal(fm.type, 'Space');
  assert.equal(fm.title, 'Eucalyptus: telehealth & "more"');
  assert.deepEqual(fm.tags, ['space']);
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
  // Organisation ids are NOT uniform (legacy 'org:halter' in old seeds, today's
  // 'community:halter'), so the same communities/ path can back either id shape
  // — only the map (built by entityNotePath over real nodes) can invert it.
  const legacyOrg = { id: 'org:halter', type: 'organization' };
  const currentOrg = { id: 'community:halter', type: 'Space' };
  assert.equal(entityNotePath(legacyOrg), 'communities/halter.md');
  assert.equal(entityNotePath(currentOrg), 'communities/halter.md');

  const viaLegacy = new Map([[entityNotePath(legacyOrg)!, { id: legacyOrg.id }]]);
  const viaCurrent = new Map([[entityNotePath(currentOrg)!, { id: currentOrg.id }]]);
  assert.equal(resolveEntityNode('communities/halter.md', viaLegacy), 'org:halter');
  assert.equal(resolveEntityNode('communities/halter.md', viaCurrent), 'community:halter');

  const people = new Map([['people/craig-piggott.md', { id: 'person:craig-piggott' }]]);
  assert.equal(resolveEntityNode('people/craig-piggott.md', people), 'person:craig-piggott');
  // Entity-shaped path with no node in the map (deleted node / other space /
  // map still loading) → null, so callers fall back to opening in place.
  assert.equal(resolveEntityNode('people/unknown.md', people), null);
  // Non-entity paths are never resolved, whatever the map contains.
  assert.equal(resolveEntityNode('notes/welcome.md', new Map([['notes/welcome.md', { id: 'x' }]])), null);
  // Tolerates a missing map.
  assert.equal(resolveEntityNode('people/craig-piggott.md', null), null);
});
