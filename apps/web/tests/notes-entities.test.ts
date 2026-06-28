import test from 'node:test';
import assert from 'node:assert/strict';
import {
  entityKindOf,
  entityNotePath,
  parseEntityHref,
  entityKindOfPath,
  entityStub,
} from '../lib/notes/entities';
import { parseFrontmatter } from '../lib/notes/shared/markdown';

test('entityKindOf classifies node types liberally', () => {
  assert.equal(entityKindOf('person'), 'person');
  assert.equal(entityKindOf('Person'), 'person');
  assert.equal(entityKindOf('organization'), 'company');
  assert.equal(entityKindOf('org'), 'company');
  assert.equal(entityKindOf('company'), 'company');
  assert.equal(entityKindOf('event'), null);
  assert.equal(entityKindOf(''), null);
  assert.equal(entityKindOf(null), null);
});

test('entityNotePath derives people/ and companies/ paths from the node id', () => {
  assert.equal(entityNotePath({ id: 'person:craig-piggott', type: 'person' }), 'people/craig-piggott.md');
  assert.equal(entityNotePath({ id: 'org:halter', type: 'organization' }), 'companies/halter.md');
  // slug comes from the id, not the name (collision-proof)
  assert.equal(entityNotePath({ id: 'person:jane-doe-acme', type: 'person', name: 'Jane Doe' }), 'people/jane-doe-acme.md');
  // non-entity nodes return null
  assert.equal(entityNotePath({ id: 'event:summit', type: 'event' }), null);
});

test('parseEntityHref normalizes only valid entity hrefs', () => {
  assert.equal(parseEntityHref('/people/craig-piggott.md'), 'people/craig-piggott.md');
  assert.equal(parseEntityHref('companies/halter.md'), 'companies/halter.md');
  assert.equal(parseEntityHref('/notes/welcome.md'), null);
  assert.equal(parseEntityHref('/people/craig'), null); // missing .md
  assert.equal(parseEntityHref('https://example.com'), null);
  assert.equal(parseEntityHref(''), null);
});

test('path <-> node id round trips', () => {
  const node = { id: 'person:craig-piggott', type: 'person' };
  const path = entityNotePath(node)!;
  assert.equal(parseEntityHref(`/${path}`), path);
  assert.equal(entityKindOfPath(path), 'person');
  assert.equal(entityKindOfPath('companies/halter.md'), 'company');
  assert.equal(entityKindOfPath('notes/welcome.md'), null);
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

test('entityStub escapes tricky names so frontmatter still parses', () => {
  const md = entityStub({ id: 'org:eucalyptus', type: 'organization', name: 'Eucalyptus: telehealth & "more"' });
  const fm = parseFrontmatter(md);
  assert.equal(fm.type, 'Company');
  assert.equal(fm.title, 'Eucalyptus: telehealth & "more"');
  assert.deepEqual(fm.tags, ['company']);
});
