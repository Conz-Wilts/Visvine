// How a resource node names the file it shows, and the title a file gives it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileIdOf, resourceNameOf } from '../lib/resources/shared/fileNode'

test('a resource shows the file its metadata names', () => {
  assert.equal(fileIdOf({ fileId: 'res_1' }), 'res_1')
  assert.equal(fileIdOf({ fileId: '' }), null)
  assert.equal(fileIdOf({ fileId: 7 }), null)
  assert.equal(fileIdOf({}), null)
  assert.equal(fileIdOf(null), null)
})

test('a file names its resource without the extension', () => {
  assert.equal(resourceNameOf('Q3 report.pdf'), 'Q3 report')
  assert.equal(resourceNameOf('roll-up.xlsx'), 'roll-up')
  assert.equal(resourceNameOf('Revenue roll-up (Q3)'), 'Revenue roll-up (Q3)')
  assert.equal(resourceNameOf('v1.2 plan final'), 'v1.2 plan final')
  assert.equal(resourceNameOf('.env'), '.env')
})
