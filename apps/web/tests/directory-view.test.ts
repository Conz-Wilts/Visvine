import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDirectoryView } from '../lib/directoryView';

test('parses the four valid views', () => {
  assert.equal(parseDirectoryView('grid', true), 'grid');
  assert.equal(parseDirectoryView('table', true), 'table');
  assert.equal(parseDirectoryView('graph', true), 'graph');
  assert.equal(parseDirectoryView('context', true), 'context');
});

test('absent or junk values fall back to grid', () => {
  assert.equal(parseDirectoryView(null, true), 'grid');
  assert.equal(parseDirectoryView(undefined, true), 'grid');
  assert.equal(parseDirectoryView('', true), 'grid');
  assert.equal(parseDirectoryView('GRID', true), 'grid');
  assert.equal(parseDirectoryView('kanban', true), 'grid');
});

test('context collapses to grid while the notes tool is disabled', () => {
  assert.equal(parseDirectoryView('context', false), 'grid');
  // Other views are unaffected by the toggle.
  assert.equal(parseDirectoryView('graph', false), 'graph');
});
