// The interface half of the `hello` fixture Tool. Compiled server-side on every
// write (lib/tools/compile.ts): only react, react-dom and @visvine/tool-kit are
// importable, and the default export is what the frame runtime mounts.
//
// Everything it touches sits under `demo/`, which is exactly what index.md's
// `perimeter:` block declares — the bridge refuses anything else.
import { useState } from 'react'
import {
  Banner,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Spinner,
  Stack,
  Table,
  useQuery,
  useVisvine,
} from '@visvine/tool-kit'
import type { ContextEntry } from '@visvine/tool-kit'

const DEMO_GLOB = 'demo/**'
const OUTPUT_PATH = 'demo/from-tool.md'

/** In the compiled bundle too, so the verify script can prove which code the
 *  runtime route is serving without parsing minified JSX. */
const MARKER = 'verify-tools-e2e:hello'

interface Summary {
  glob: string
  notes: number
  bytes: number
  byType: Record<string, number>
}

function noteBody(): string {
  return [
    '---',
    'title: From the tool',
    `marker: ${MARKER}`,
    '---',
    '',
    'This note was written from inside a Visvine Tool, through the bridge, under',
    "the viewer's own grants and within the tool's declared write perimeter.",
    '',
  ].join('\n')
}

export default function Hello() {
  const visvine = useVisvine()
  const [wrote, setWrote] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const notes = useQuery(() => visvine.context.list(DEMO_GLOB), [])
  const summary = useQuery(() => visvine.data.call<Summary>('summarise', { glob: DEMO_GLOB }), [])

  async function write() {
    setFailed(null)
    try {
      const result = await visvine.context.write(OUTPUT_PATH, noteBody())
      setWrote(result.path)
      notes.reload()
      summary.reload()
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e))
    }
  }

  const columns = [
    { key: 'path', header: 'Note', render: (row: ContextEntry) => row.path },
    { key: 'title', header: 'Title', render: (row: ContextEntry) => row.title ?? '—' },
    { key: 'type', header: 'Type', render: (row: ContextEntry) => row.type ?? '—' },
  ]

  return (
    <Stack gap="md">
      <PageHeader
        title="Hello"
        description={`Notes under ${DEMO_GLOB}, read through the bridge.`}
        actions={
          <Button variant="primary" onClick={write}>
            Write {OUTPUT_PATH}
          </Button>
        }
      />

      {failed ? <Banner tone="danger" title="That write was refused">{failed}</Banner> : null}
      {wrote ? <Banner tone="success" title="Saved">{wrote}</Banner> : null}

      <Card title="Demo notes">
        {notes.loading ? <Spinner /> : null}
        {notes.error ? <Banner tone="danger" title="Could not list notes">{notes.error.message}</Banner> : null}
        {notes.data ? (
          <Table
            columns={columns}
            rows={notes.data}
            rowKey={(row) => row.path}
            empty={<EmptyState title="Nothing here yet" description={`No notes match ${DEMO_GLOB}.`} />}
          />
        ) : null}
      </Card>

      <Card title="Counts from data.js">
        {summary.loading ? <Spinner /> : null}
        {summary.error ? <Banner tone="danger" title="Handler failed">{summary.error.message}</Banner> : null}
        {summary.data ? (
          <p>
            {summary.data.notes} note(s), {summary.data.bytes} bytes — {MARKER}
          </p>
        ) : null}
      </Card>
    </Stack>
  )
}
