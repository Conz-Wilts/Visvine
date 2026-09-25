import test from 'node:test';
import assert from 'node:assert/strict';
import { adoptedNotePath, entityNotePath, entityOwnerPathOf, resolveEntityOwner } from '@/lib/notes/entities';
import {
  crumbsOf,
  isUnderResources,
  parentFolderOfResource,
  resourceMoveDenial,
} from '@/lib/resources/shared/resourceTree';

test('a note directly inside a resource folder belongs to it by shape', () => {
  assert.equal(entityOwnerPathOf('resources/logo/notes.md'), 'resources/logo');
});

test('anything deeper under resources/ is owned by the map, not the shape', () => {
  assert.equal(entityOwnerPathOf('resources/design/logo/index.md'), null);
  assert.equal(entityOwnerPathOf('resources/design/logo/notes.md'), null);
  // Other namespaces keep the shape rule.
  assert.equal(entityOwnerPathOf('people/craig/deals/acme.md'), 'people/craig');
});

test('a filed resource is found through its ancestor index', () => {
  const map = new Map([['resources/design/logo/index.md', { id: 'resource:logo' }]]);
  assert.deepEqual(resolveEntityOwner('resources/design/logo/notes.md', map), {
    id: 'resource:logo',
    subPath: 'notes.md',
  });
  assert.equal(resolveEntityOwner('resources/design/readme.md', map), null);
});

test('a filed resource node answers to its pointer; at the top, to its kind', () => {
  const filed = { id: 'resource:logo', type: 'resource', metadata: { notePath: 'resources/design/logo/index.md' } };
  assert.equal(adoptedNotePath(filed), 'resources/design/logo/index.md');
  assert.equal(entityNotePath(filed), 'resources/design/logo/index.md');
  const home = { id: 'resource:logo', type: 'resource', metadata: { notePath: 'resources/logo/index.md' } };
  assert.equal(adoptedNotePath(home), null);
  assert.equal(entityNotePath(home), 'resources/logo/index.md');
});

test('a resource moves within resources/ under its own name', () => {
  assert.equal(resourceMoveDenial('resources/logo', 'resources/design/logo'), null);
  assert.equal(resourceMoveDenial('resources/design/logo', 'resources/logo'), null);
  assert.ok(resourceMoveDenial('resources/logo', 'resources/design/brand-mark'));
  assert.ok(resourceMoveDenial('resources/logo', 'notes/logo'));
});

test('tree paths', () => {
  assert.equal(isUnderResources('resources/a'), true);
  assert.equal(isUnderResources('resources'), false);
  assert.equal(parentFolderOfResource('resources/design/logo/index.md'), 'resources/design');
  assert.equal(parentFolderOfResource('resources/logo/index.md'), 'resources');
  assert.deepEqual(crumbsOf('resources/design/logos'), ['resources', 'resources/design', 'resources/design/logos']);
});
