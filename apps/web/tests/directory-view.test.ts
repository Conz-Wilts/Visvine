import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDirectoryView } from '../lib/directoryView';

test('parses the three valid views', () => {
  assert.equal(parseDirectoryView('grid'), 'grid');
  assert.equal(parseDirectoryView('table'), 'table');
  assert.equal(parseDirectoryView('graph'), 'graph');
});

test('absent or junk values fall back to grid', () => {
  assert.equal(parseDirectoryView(null), 'grid');
  assert.equal(parseDirectoryView(undefined), 'grid');
  assert.equal(parseDirectoryView(''), 'grid');
  assert.equal(parseDirectoryView('GRID'), 'grid');
  assert.equal(parseDirectoryView('kanban'), 'grid');
  // The retired context view is junk now — it falls back like any other.
  assert.equal(parseDirectoryView('context'), 'grid');
});
