import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalEntityPath,
  entityKindOf,
  entityNotePath,
  entityTypeNamesKind,
  isFolderOnlyEntityKind,
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
  namespaceFolderDenial,
  structuralFolders,
  entityKindOfDir,
  entityContextHref,
  hrefForNotePath,
  noteHref,
} from '../lib/notes/entities';
import { isCreatableType } from '../lib/directory/createEntity';
import { parseFrontmatter } from '../lib/notes/shared/markdown';
import { toolFileKindOfPath, toolNameOfPath } from '../lib/tools/config';

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
  // An organisation and a channel are folder-only; a section is config and stays flat.
  assert.equal(entityNotePath({ id: 'community:blackbird', type: 'space' }), 'communities/blackbird/index.md');
  assert.equal(entityNotePath({ id: 'space:engineering', type: 'section' }), 'spaces/engineering.md');
  assert.equal(entityNotePath({ id: 'channel:general', type: 'channel' }), 'channels/general/index.md');
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

test('tools are a folder-only entity namespace', () => {
  assert.equal(entityKindOf('tool'), 'tool');
  assert.equal(entityKindOf('Tools'), 'tool');
  const node = { id: 'tool:deal-pipeline', type: 'tool' };
  // The entity note IS the folder index, always — a Tool is its config note plus
  // its source sub-notes from the moment it exists, so it never has a flat form.
  assert.equal(entityNotePath(node), 'tools/deal-pipeline/index.md');
  assert.equal(entityFolderPathOf(node), 'tools/deal-pipeline');
  assert.equal(entityIndexPathOf(node), 'tools/deal-pipeline/index.md');
  // …and nothing can point it elsewhere, pointer or no pointer.
  assert.equal(
    entityNotePath({ ...node, metadata: { notePath: 'tools/deal-pipeline.md' } }),
    'tools/deal-pipeline/index.md',
  );
  // Only the index is registered in the reverse map: the flat path is an
  // ordinary note path that must never resolve to the tool.
  assert.deepEqual(entityNotePaths(node), ['tools/deal-pipeline/index.md']);
  assert.equal(entityKindOfPath('tools/deal-pipeline/index.md'), 'tool');
  assert.equal(isEntityFolderIndex('tools/deal-pipeline/index.md'), true);
  assert.equal(parseEntityHref('/tools/deal-pipeline/index.md'), 'tools/deal-pipeline/index.md');
  // The flat form is NOT an entity path — a tool is folder-only.
  assert.equal(parseEntityHref('tools/deal-pipeline.md'), null);
  assert.equal(entityKindOfPath('tools/deal-pipeline.md'), null);
  assert.equal(isEntityFolderIndex('tools/deal-pipeline.md'), false);
  // The namespace's own index is a plain folder index, as everywhere else.
  assert.equal(parseEntityHref('tools/index.md'), null);
  // Authoring one from the directory is not a door — the note comes first.
  assert.equal(isCreatableType('tool'), false);
});

test('a tool’s source files are sub-notes owned by the tool node', () => {
  assert.equal(parseEntityHref('tools/deal-pipeline/ui.md'), null);
  assert.equal(entityKindOfPath('tools/deal-pipeline/ui.md'), null);
  assert.equal(entityKindOfDir('tools/deal-pipeline/data.md'), 'tool');
  assert.equal(entityOwnerPathOf('tools/deal-pipeline/ui.md'), 'tools/deal-pipeline');
  assert.equal(entityOwnerPathOf('/tools/deal-pipeline/data.md'), 'tools/deal-pipeline');
  assert.equal(entityOwnerPathOf('tools/deal-pipeline/index.md'), null); // the entity note itself
  assert.equal(entityOwnerPathOf('tools/deal-pipeline.md'), null);

  const map = new Map([['tools/deal-pipeline/index.md', { id: 'tool:deal-pipeline' }]]);
  assert.deepEqual(resolveEntityOwner('tools/deal-pipeline/index.md', map), {
    id: 'tool:deal-pipeline',
    subPath: null,
  });
  assert.deepEqual(resolveEntityOwner('tools/deal-pipeline/ui.md', map), {
    id: 'tool:deal-pipeline',
    subPath: 'ui.md',
  });
  assert.equal(resolveEntityNode('tools/deal-pipeline.md', map), null);
  assert.equal(hrefForNotePath('tools/deal-pipeline/ui.md', map), entityContextHref('tool:deal-pipeline', 'ui.md'));
  assert.equal(hrefForNotePath('tools/deal-pipeline.md', map), noteHref('tools/deal-pipeline.md'));
});

test('the tool path helpers (lib/tools/config) name the tool a path belongs to', () => {
  // isToolIndexPath / toolNameOfEntityPath used to live here as a second,
  // looser pair — they've been consolidated onto lib/tools/config.ts's
  // TOOL_NAME_RE-validated helpers, which are the single source of truth.
  assert.equal(toolFileKindOfPath('tools/deal-pipeline/index.md'), 'index');
  assert.equal(toolFileKindOfPath('tools/deal-pipeline.md'), 'other');
  assert.equal(toolFileKindOfPath('tools/deal-pipeline/ui.md'), 'ui');
  assert.equal(toolFileKindOfPath('tools/index.md'), 'other');
  assert.equal(toolFileKindOfPath('people/connor/index.md'), null);

  assert.equal(toolNameOfPath('tools/deal-pipeline/index.md'), 'deal-pipeline');
  assert.equal(toolNameOfPath('/tools/deal-pipeline/ui.md'), 'deal-pipeline');
  assert.equal(toolNameOfPath('tools/deal-pipeline/nested/notes.md'), 'deal-pipeline');
  assert.equal(toolNameOfPath('tools/deal-pipeline.md'), null);
  assert.equal(toolNameOfPath('tools/index.md'), null);
  assert.equal(toolNameOfPath('agents/nightly.md'), null);
  // Unlike the old entities.ts pair, a folder name TOOL_NAME_RE would reject
  // is rejected here too — this is exactly the disagreement that got fixed.
  assert.equal(toolNameOfPath('tools/Deal Pipeline/index.md'), null);
  assert.equal(toolFileKindOfPath('tools/Deal Pipeline/index.md'), 'other');
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

test('entityNotePath derives people/ and communities/ folders from the node id', () => {
  assert.equal(entityNotePath({ id: 'person:craig-piggott', type: 'person' }), 'people/craig-piggott/index.md');
  assert.equal(entityNotePath({ id: 'community:halter', type: 'space' }), 'communities/halter/index.md');
  // …and every retired organisation spelling lands in the same namespace.
  assert.equal(entityNotePath({ id: 'org:halter', type: 'organization' }), 'communities/halter/index.md');
  assert.equal(entityNotePath({ id: 'group:halter', type: 'Group' }), 'communities/halter/index.md');
  assert.equal(entityNotePath({ id: 'resource:founder-playbook', type: 'resource' }), 'resources/founder-playbook/index.md');
  assert.equal(entityNotePath({ id: 'event:summit', type: 'event' }), 'events/summit/index.md');
  // slug comes from the id, not the name (collision-proof)
  assert.equal(entityNotePath({ id: 'person:jane-doe-acme', type: 'person', name: 'Jane Doe' }), 'people/jane-doe-acme/index.md');
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

test('a person is a folder from the first write, and the flat path is its alias', () => {
  const node = { id: 'person:connor', type: 'person' };
  assert.equal(entityFlatPath(node), 'people/connor.md');
  assert.equal(entityFolderPathOf(node), 'people/connor');
  assert.equal(entityIndexPathOf(node), 'people/connor/index.md');
  assert.equal(entityNotePath(node), 'people/connor/index.md');
  // Both forms resolve to the node — a link written to people/connor.md still lands.
  assert.deepEqual(entityNotePaths(node), ['people/connor.md', 'people/connor/index.md']);
  // No pointer can move it: the index is the note whatever metadata says.
  assert.equal(entityNotePath({ ...node, metadata: { notePath: 'people/connor.md' } }), 'people/connor/index.md');
  assert.equal(entityNotePath({ ...node, metadata: { notePath: 42 } }), 'people/connor/index.md');
  for (const [id, type, index] of [
    ['event:launch', 'event', 'events/launch/index.md'],
    ['resource:deck', 'resource', 'resources/deck/index.md'],
    ['channel:general', 'channel', 'channels/general/index.md'],
    ['company:halter', 'company', 'communities/halter/index.md'],
  ] as const) {
    assert.equal(entityNotePath({ id, type }), index);
    assert.equal(isFolderOnlyEntityKind(entityKindOf(type)), true);
  }
  assert.deepEqual(entityNotePaths({ id: 'note:x', type: 'note' }), []);
});

test('the config kinds stay flat until a sub-note converts them', () => {
  const node = { id: 'connector:sandbox', type: 'connector' };
  assert.equal(isFolderOnlyEntityKind('connector'), false);
  assert.equal(isFolderOnlyEntityKind('agent'), false);
  assert.equal(isFolderOnlyEntityKind('section'), false);
  assert.equal(isFolderOnlyEntityKind(null), false);
  assert.equal(entityNotePath(node), 'connectors/sandbox.md');
  assert.deepEqual(entityNotePaths(node), ['connectors/sandbox.md', 'connectors/sandbox/index.md']);
  assert.equal(
    entityNotePath({ ...node, metadata: { notePath: 'connectors/sandbox/index.md' } }),
    'connectors/sandbox/index.md',
  );
  // A pointer at some other note is ignored — it can only name this node's own index.
  assert.equal(entityNotePath({ ...node, metadata: { notePath: 'connectors/other/index.md' } }), 'connectors/sandbox.md');
});

test('entityTypeNamesKind accepts any spelling of a directory kind, exact for config kinds', () => {
  assert.equal(entityTypeNamesKind('Company', 'company'), true);
  assert.equal(entityTypeNamesKind('Space', 'company'), true);
  assert.equal(entityTypeNamesKind('Organisation', 'space'), true);
  assert.equal(entityTypeNamesKind('Person', 'person'), true);
  assert.equal(entityTypeNamesKind('People', 'person'), true);
  assert.equal(entityTypeNamesKind('Deal', 'company'), false);
  assert.equal(entityTypeNamesKind('', 'person'), false);
  assert.equal(entityTypeNamesKind('tool', 'tool'), true);
  assert.equal(entityTypeNamesKind('Tools', 'tool'), false);
  assert.equal(entityTypeNamesKind('Connectors', 'connector'), false);
  assert.equal(entityTypeNamesKind('Person', 'note'), false);
});

test('canonicalEntityPath sends a folder-only alias to the index and leaves everything else alone', () => {
  assert.equal(canonicalEntityPath('people/connor.md'), 'people/connor/index.md');
  assert.equal(canonicalEntityPath('/events/launch.md'), 'events/launch/index.md');
  assert.equal(canonicalEntityPath('people/connor/index.md'), 'people/connor/index.md');
  // A sub-note, a namespace root and an ordinary note are not aliases of anything.
  assert.equal(canonicalEntityPath('people/connor/comms.md'), 'people/connor/comms.md');
  assert.equal(canonicalEntityPath('people/index.md'), 'people/index.md');
  assert.equal(canonicalEntityPath('deals/halter.md'), 'deals/halter.md');
  // A lazy kind's flat path is where its note may really be — the store decides.
  assert.equal(canonicalEntityPath('connectors/sandbox.md'), 'connectors/sandbox.md');
  assert.equal(canonicalEntityPath('spaces/engineering.md'), 'spaces/engineering.md');
  // A tool has no alias: tools/<name>.md is an ordinary note.
  assert.equal(canonicalEntityPath('tools/deal-pipeline.md'), 'tools/deal-pipeline.md');
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
  assert.equal(entityNotePath(legacyOrg), 'communities/halter/index.md');
  assert.equal(entityNotePath(currentOrg), 'communities/halter/index.md');

  const viaLegacy = new Map([[entityNotePath(legacyOrg)!, { id: legacyOrg.id }]]);
  const viaCurrent = new Map([[entityNotePath(currentOrg)!, { id: currentOrg.id }]]);
  assert.equal(resolveEntityNode('communities/halter/index.md', viaLegacy), 'org:halter');
  assert.equal(resolveEntityNode('communities/halter/index.md', viaCurrent), 'community:halter');

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

test('namespaceFolderDenial pins the built-in folders, not what is inside them', () => {
  // The three the runtime resolves against by name...
  for (const dir of ['agents', 'connectors', 'tools']) {
    assert.ok(namespaceFolderDenial(dir), `${dir} should be undeletable`);
  }
  // ...and the entity namespaces, which are the same bargain: every note's
  // path is its identity, so removing the folder would trash all of them.
  for (const dir of ['people', 'communities', 'events', 'resources', 'channels', 'spaces']) {
    assert.ok(namespaceFolderDenial(dir), `${dir} should be undeletable`);
  }

  // Everything INSIDE stays ordinary — deleting one agent, one Tool or one
  // person is exactly the operation the guard is there to keep possible.
  assert.equal(namespaceFolderDenial('agents/ops'), null);
  assert.equal(namespaceFolderDenial('agents/live'), null);
  assert.equal(namespaceFolderDenial('tools/roster'), null);
  assert.equal(namespaceFolderDenial('connectors/hubspot'), null);
  assert.equal(namespaceFolderDenial('people/craig-piggott'), null);

  // A folder that merely starts with the name isn't the namespace.
  assert.equal(namespaceFolderDenial('agents-archive'), null);
  assert.equal(namespaceFolderDenial('ops/agents'), null);
  assert.equal(namespaceFolderDenial(''), null);
});

test('structuralFolders follows the tools a space runs', () => {
  // Nothing configured: every tool is on by default, so all three are there.
  assert.deepEqual(structuralFolders(null).sort(), ['agents', 'connectors', 'tools']);

  // Agents off -> no agents/ folder; the other two are untouched.
  assert.deepEqual(
    structuralFolders({ enabled: { agents: false } }).sort(),
    ['connectors', 'tools'],
  );
  // connectors and tools are core feature keys, so they survive even an
  // explicit false — "they are always there" needs no special case.
  assert.deepEqual(
    structuralFolders({ enabled: { connectors: false } }).sort(),
    ['agents', 'connectors', 'tools'],
  );
  assert.deepEqual(
    structuralFolders({ enabled: { agents: false, connectors: false, tools: false } }).sort(),
    ['connectors', 'tools'],
  );
});
