import test from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PersonAvatar, RecordBoard, RecordForm, missingRequired, type FieldDef } from '@/features/tools/kit/components/records'

// tsx preserves this app's classic JSX mode; the production kit uses esbuild's automatic runtime.
Object.assign(globalThis, { React })

const fields: FieldDef[] = [
  { key: 'name', label: 'Objective', kind: 'text', required: true },
  { key: 'status', label: 'Status', kind: 'select', options: [{ value: 'Active' }] },
  { key: 'progress', label: 'Progress', kind: 'percent' },
]

test('a board averages percentages, preserves their units, and ignores missing values', () => {
  const html = renderToStaticMarkup(createElement(RecordBoard, {
    fields, groupBy: 'status', sumField: 'progress', onMove: () => {},
    rows: [
      { id: 'a', data: { name: 'Renewals', status: 'Active', progress: 50 } },
      { id: 'b', data: { name: 'Activation', status: 'Active', progress: 70 } },
      { id: 'c', data: { name: 'Interviews', status: 'Active', progress: null } },
    ],
  }))
  assert.match(html, /60% avg/)
  assert.doesNotMatch(html, /120/)
  assert.match(html, /50%/)
  assert.match(html, /70%/)
})

test('initials avatars actually receive their name-derived token colours', () => {
  const ana = renderToStaticMarkup(createElement(PersonAvatar, { name: 'Ana Silva' }))
  const sam = renderToStaticMarkup(createElement(PersonAvatar, { name: 'Sam Lee' }))
  assert.match(ana, /background-color:var\(--vv-color-hue-\w+-wash\)/)
  assert.match(ana, /color:var\(--vv-color-hue-\w+-fg\)/)
  assert.notEqual(ana.match(/style="([^"]+)"/)?.[1], sam.match(/style="([^"]+)"/)?.[1])
})

test('required record fields are identifiable before submission', () => {
  const html = renderToStaticMarkup(createElement(RecordForm, { fields, value: {}, onChange: () => {} }))
  assert.match(html, /aria-label="required"/)
  assert.match(html, /aria-required="true"/)
})


test('required values reject whitespace while allowing zero and false', () => {
  const fields: FieldDef[] = [
    { key: 'title', label: 'Title', kind: 'text', required: true },
    { key: 'count', label: 'Count', kind: 'number', required: true },
    { key: 'approved', label: 'Approved', kind: 'boolean', required: true },
  ]
  assert.deepEqual(missingRequired(fields, { title: '   ', count: 0, approved: false }), ['title'])
})
