// The Directory's tab set and the hrefs its tabs navigate to.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CONTEXT_TAB_ID,
  directoryTabs,
  directoryViewHref,
  isDirectoryView,
  RESOURCES_HREF,
} from '../lib/directory/views'

test('Context sits beside Grid, before the Table', () => {
  assert.deepEqual(
    directoryTabs().map((t) => t.id),
    ['grid', CONTEXT_TAB_ID, 'table'],
  )
})

test('Context is not a view — it is a navigation', () => {
  assert.equal(isDirectoryView('grid'), true)
  assert.equal(isDirectoryView('table'), true)
  assert.equal(isDirectoryView('resources'), false)
  assert.equal(isDirectoryView(CONTEXT_TAB_ID), false)
})

test('the grid is the bare route; the others name themselves', () => {
  assert.equal(directoryViewHref('grid'), '/directory')
  assert.equal(directoryViewHref('table'), '/directory?view=table')
})

test('a type rides along, lower-cased, so the round trip remembers it', () => {
  assert.equal(directoryViewHref('table', 'Person'), '/directory?view=table&type=person')
  // The grid ignores the type, and keeps it so returning to the table lands
  // back on the same one.
  assert.equal(directoryViewHref('grid', 'event'), '/directory?type=event')
})

test('a blank type is no type at all', () => {
  assert.equal(directoryViewHref('table', ''), '/directory?view=table')
  assert.equal(directoryViewHref('table', '   '), '/directory?view=table')
  assert.equal(directoryViewHref('table', null), '/directory?view=table')
  assert.equal(directoryViewHref('table', undefined), '/directory?view=table')
})

test('a type that needs escaping is escaped', () => {
  assert.equal(directoryViewHref('table', 'deal flow'), '/directory?view=table&type=deal+flow')
})

test('a Resources link lands on the resources table', () => {
  assert.equal(RESOURCES_HREF, '/directory?view=table&type=resource')
})
