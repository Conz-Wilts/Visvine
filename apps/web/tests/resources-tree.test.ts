import test from 'node:test';
import assert from 'node:assert/strict';
import { childFolders, folderPathLabel, folderTrail, subtree } from '../features/resources/lib/tree';
import type { ResourceFolder } from '../lib/types';

const f = (id: string, name: string, parentId: string | null): ResourceFolder => ({
  id, name, parentId, spaceId: 's', createdBy: 'u', createdAt: '2026-08-22T00:00:00.000Z',
});
const folders = [f('a', 'Reports', null), f('b', '2026', 'a'), f('c', 'Q3', 'b'), f('d', 'Images', null)];

test('folderTrail walks root → leaf and is empty at the root', () => {
  assert.deepEqual(folderTrail(folders, 'c').map(x => x.id), ['a', 'b', 'c']);
  assert.deepEqual(folderTrail(folders, null), []);
  assert.deepEqual(folderTrail(folders, 'missing'), []);
});

test('folderTrail survives a cycle', () => {
  const cyclic = [f('x', 'X', 'y'), f('y', 'Y', 'x')];
  assert.equal(folderTrail(cyclic, 'x').length, 2);
});

test('subtree includes the folder and everything beneath it', () => {
  assert.deepEqual([...subtree(folders, 'a')].sort(), ['a', 'b', 'c']);
  assert.deepEqual([...subtree(folders, 'd')], ['d']);
});

test('folderPathLabel and childFolders', () => {
  assert.equal(folderPathLabel(folders, 'c'), 'Reports / 2026 / Q3');
  assert.equal(folderPathLabel(folders, null), 'Resources');
  assert.deepEqual(childFolders(folders, null).map(x => x.name), ['Images', 'Reports']);
});
