import { useState } from 'react'
import { Button, EmptyState, Input, Row, Stack, Table, useLiveQuery, useVisvine } from '@visvine/tool-kit'
import { slugOf } from './slug'

// The notes in the folder this space bound to `notes`, newest first, and a
// line to add one. `summary` runs in data.js, beside the space's data.
export default function App() {
  const visvine = useVisvine()
  const folder = visvine.install.bindings?.notes ?? 'board'
  const live = { paths: [`${folder}/**`] }
  const notes = useLiveQuery(() => visvine.context.list(`${folder}/**`), [folder], live)
  const summary = useLiveQuery(() => visvine.data.call<{ notes: number; words: number }>('summary', { folder }), [folder], live)
  const [title, setTitle] = useState('')

  const add = async () => {
    const slug = slugOf(title)
    if (!slug) return
    await visvine.context.write(`${folder}/${slug}.md`, `---\ntitle: ${JSON.stringify(title.trim())}\n---\n`)
    setTitle('')
  }

  const rows = [...(notes.data ?? [])].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  return (
    <Stack gap="md">
      <Row gap={2}>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New note" aria-label="New note" />
        <Button variant="primary" onClick={add} disabled={!slugOf(title)}>
          Add
        </Button>
      </Row>
      {summary.data && (
        <span style={{ color: 'var(--vv-color-fg-muted)', fontSize: 12 }}>
          {summary.data.notes} notes · {summary.data.words} words
        </span>
      )}
      {rows.length === 0 && !notes.loading ? (
        <EmptyState title="No notes yet" />
      ) : (
        <Table
          columns={[
            { key: 'title', header: 'Title', render: (row) => row.title ?? row.path },
            { key: 'updated', header: 'Updated', render: (row) => new Date(row.updatedAt).toLocaleDateString(), align: 'right' },
          ]}
          rows={rows}
          rowKey={(row) => row.path}
          onRowClick={(row) => void visvine.ui.openRecord({ path: row.path })}
        />
      )}
    </Stack>
  )
}
