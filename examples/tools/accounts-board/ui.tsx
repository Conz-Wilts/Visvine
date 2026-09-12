// The interface half of the Accounts Board. Compiled server-side on every
// write (lib/tools/compile.ts): only react and @visvine/tool-kit are
// importable, and the default export is what the frame runtime mounts.
//
// Everything it reads goes through data.js, which is the one place that knows
// the note layout — see index.md. This file only draws.
import {
  Button,
  Card,
  Chip,
  EmptyState,
  PageHeader,
  Spinner,
  Stack,
  useQuery,
  useVisvine,
} from '@visvine/tool-kit'
import type { ChipTone } from '@visvine/tool-kit'

interface Org {
  slug: string
  path: string
  title: string
  segment: string
  relationship: string
  updatedAt?: string
}

interface Segment {
  name: string
  orgs: Org[]
}

interface Board {
  segments: Segment[]
  total: number
  truncated: boolean
  limit: number
}

/** Relationship vocabulary varies by space, so this maps what it knows and
 *  leaves everything else neutral rather than inventing a colour for a
 *  relationship it has never seen. */
const RELATIONSHIP_TONES: Record<string, ChipTone> = {
  customer: 'accent',
  'design-partner': 'info',
  prospect: 'info',
  investor: 'info',
  partner: 'neutral',
}

function toneForRelationship(relationship: string): ChipTone {
  return RELATIONSHIP_TONES[relationship.toLowerCase()] ?? 'neutral'
}

export default function AccountsBoard() {
  const visvine = useVisvine()
  const board = useQuery(() => visvine.data.call<Board>('loadBoard'), [])

  if (board.loading) return <Spinner label="Loading the accounts…" />
  if (board.error) {
    return <EmptyState title="The board could not load" description={board.error.message} />
  }

  const data = board.data
  if (!data || data.total === 0) {
    return (
      <EmptyState
        title="No organisations yet"
        description="This board reads communities/**/index.md. Add an organisation note and it appears here."
      />
    )
  }

  const segmentCount = data.segments.length
  const description = data.truncated
    ? `Showing the first ${data.total} organisations — this space has more than one board load can read (${data.limit}).`
    : `${data.total} ${data.total === 1 ? 'organisation' : 'organisations'} across ${segmentCount} ${
        segmentCount === 1 ? 'segment' : 'segments'
      }`

  return (
    <Stack gap="lg">
      <PageHeader title="Accounts" description={description} />
      {data.segments.map((segment) => (
        <Stack key={segment.name} gap="sm">
          <Stack direction="row" gap="sm">
            <strong>{segment.name}</strong>
            <Chip tone="neutral">{String(segment.orgs.length)}</Chip>
          </Stack>
          <div style={grid}>
            {segment.orgs.map((org) => (
              <Card key={org.path} title={org.title}>
                <Stack gap="sm">
                  {org.relationship ? (
                    <div>
                      <Chip tone={toneForRelationship(org.relationship)}>{org.relationship}</Chip>
                    </div>
                  ) : null}
                  <Button
                    variant="ghost"
                    onClick={() => visvine.navigate(`/directory/note/${org.path}`)}
                  >
                    Open note
                  </Button>
                </Stack>
              </Card>
            ))}
          </div>
        </Stack>
      ))}
    </Stack>
  )
}

const grid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
  gap: '12px',
} as const
