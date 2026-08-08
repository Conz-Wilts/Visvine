// Unit tests for the "Create new → Context / File" pure layer: title → brain
// path slugging, collision suffixing, seed note frontmatter, and the widened
// source-kind table (docx/xlsx/json) with its real extractors.
// Run: node --import tsx --test tests/create-context.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  availableFolderPath,
  availableNotePath,
  composeNotePath,
  joinBrainPath,
  newNoteContent,
  noteFileSlug,
} from '../lib/notes/shared/newContext'
import { indexPathOf } from '../lib/notes/shared/indexNote'
import {
  MAX_SOURCE_BYTES,
  SOURCE_ACCEPT,
  sourceKindOf,
} from '../lib/notes/shared/sourceTypes'
import { extractText } from '../lib/notes/sources/extract'

// --- title → path -----------------------------------------------------------------

test('noteFileSlug kebab-cases titles and drops punctuation', () => {
  assert.equal(noteFileSlug('Fundraising Playbook'), 'fundraising-playbook')
  assert.equal(noteFileSlug("Craig's  Notes!!"), 'craigs-notes')
  assert.equal(noteFileSlug('  --Q1 2026--  '), 'q1-2026')
  // A title with nothing slug-able still yields a usable filename.
  assert.equal(noteFileSlug('***'), 'untitled')
})

test('joinBrainPath tolerates stray slashes and an empty (root) folder', () => {
  assert.equal(joinBrainPath('', 'a.md'), 'a.md')
  assert.equal(joinBrainPath('deals', 'a.md'), 'deals/a.md')
  assert.equal(joinBrainPath('/deals/2026/', 'a.md'), 'deals/2026/a.md')
})

test('composeNotePath puts the slug under the chosen folder as .md', () => {
  assert.equal(composeNotePath('playbooks', 'Fundraising Playbook'), 'playbooks/fundraising-playbook.md')
  assert.equal(composeNotePath('', 'Welcome'), 'welcome.md')
})

test('availableNotePath suffixes past taken paths, per folder', () => {
  const taken = new Set(['deals/acme.md', 'deals/acme-2.md'])
  assert.equal(availableNotePath('deals', 'Acme', taken), 'deals/acme-3.md')
  // The same title in another folder is not a collision.
  assert.equal(availableNotePath('archive', 'Acme', taken), 'archive/acme.md')
  assert.equal(availableNotePath('deals', 'Beta', taken), 'deals/beta.md')
})

// An index IS a folder, so "New index" picks a FOLDER path, suffixed the same way.
test('availableFolderPath suffixes past taken folders, per parent', () => {
  const taken = new Set(['data/research', 'data/research-2'])
  assert.equal(availableFolderPath('data', 'Research', taken), 'data/research-3')
  assert.equal(availableFolderPath('', 'Research', taken), 'research')
  assert.equal(availableFolderPath('data', 'Marks', taken), 'data/marks')
  // No .md — the index note lives inside the folder this names.
  assert.equal(indexPathOf(availableFolderPath('data', 'Marks', taken)), 'data/marks/index.md')
})

// --- seed note --------------------------------------------------------------------

test('newNoteContent writes the standard frontmatter, an H1 and the body', () => {
  const content = newNoteContent({
    title: 'Fundraising Playbook',
    author: 'Ada',
    tags: ['playbook', ' gtm '],
    body: '  Seed text.  ',
  })
  assert.ok(content.startsWith('---\ntype: Note\ntitle: Fundraising Playbook\nauthor: Ada\n'))
  assert.ok(content.includes('tags: [playbook, gtm]\n'))
  assert.ok(content.includes('\n# Fundraising Playbook\n'))
  assert.ok(content.trimEnd().endsWith('Seed text.'))
})

test('newNoteContent omits the author line and empty tags when unset', () => {
  const content = newNoteContent({ title: 'Bare' })
  assert.ok(!content.includes('author:'))
  assert.ok(content.includes('tags: []\n'))
  assert.equal(content.trimEnd().endsWith('# Bare'), true)
})

// --- widened source kinds ---------------------------------------------------------

test('sourceKindOf covers the documents the File tile accepts', () => {
  assert.equal(sourceKindOf('deals.CSV'), 'csv')
  assert.equal(sourceKindOf('memo.docx'), 'docx')
  assert.equal(sourceKindOf('model.xlsx'), 'spreadsheet')
  assert.equal(sourceKindOf('legacy.xls'), 'spreadsheet')
  assert.equal(sourceKindOf('export.json'), 'json')
  // Still rejected — no extractor.
  assert.equal(sourceKindOf('report.pdf'), null)
  assert.equal(sourceKindOf('image.png'), null)
})

test('the file input accept list matches the accepted kinds', () => {
  for (const ext of ['.csv', '.md', '.txt', '.json', '.docx', '.xlsx', '.xls']) {
    assert.ok(SOURCE_ACCEPT.includes(ext), `${ext} missing from SOURCE_ACCEPT`)
  }
  assert.ok(MAX_SOURCE_BYTES >= 5 * 1024 * 1024)
})

test('text kinds decode as UTF-8 with the BOM and NULs stripped', async () => {
  const bom = String.fromCharCode(0xfeff)
  const nul = String.fromCharCode(0)
  const buffer = Buffer.from(bom + 'hello' + nul + ' world', 'utf8')
  assert.equal(await extractText(buffer, 'text'), 'hello world')
  assert.equal(await extractText(Buffer.from('{"a":1}'), 'json'), '{"a":1}')
})

test('a workbook extracts to one labelled CSV block per sheet', async () => {
  const XLSX = await import('xlsx')
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ['company', 'revenue'],
      ['Acme', 100],
    ]),
    'Deals',
  )
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['note'], ['second sheet']]), 'Notes')
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer

  const text = await extractText(buffer, 'spreadsheet')
  assert.ok(text.startsWith('## Deals'))
  assert.ok(text.includes('company,revenue'))
  assert.ok(text.includes('Acme,100'))
  assert.ok(text.includes('## Notes'))
  assert.ok(text.includes('second sheet'))
})
