// The interface half of the Portfolio Board. Compiled server-side on every
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

interface Company {
  slug: string
  path: string
  title: string
  sector: string
  status: string
  updatedAt?: string
}

interface Sector {
  name: string
  companies: Company[]
}

interface Board {
  sectors: Sector[]
  total: number
  truncated: boolean
  limit: number
}

/** Status vocabulary varies by space, so this maps what it knows and leaves
 *  everything else neutral rather than inventing a colour for a status it has
 *  never seen. */
const STATUS_TONES: Record<string, ChipTone> = {
  active: 'accent',
  onboarding: 'info',
  exit: 'info',
  exits: 'info',
  ipo: 'info',
  'written-off': 'danger',
}

function toneForStatus(status: string): ChipTone {
  return STATUS_TONES[status.toLowerCase()] ?? 'neutral'
}

export default function PortfolioBoard() {
  const visvine = useVisvine()
  const board = useQuery(() => visvine.data.call<Board>('loadPortfolio'), [])

  if (board.loading) return <Spinner label="Loading the portfolio…" />
  if (board.error) {
    return <EmptyState title="The board could not load" description={board.error.message} />
  }

  const data = board.data
  if (!data || data.total === 0) {
    return (
      <EmptyState
        title="No portfolio companies yet"
        description="This board reads communities/*.md. Add a company note and it appears here."
      />
    )
  }

  const sectorCount = data.sectors.length
  const description = data.truncated
    ? `Showing the first ${data.total} companies — this space has more than one board load can read (${data.limit}).`
    : `${data.total} ${data.total === 1 ? 'company' : 'companies'} across ${sectorCount} ${
        sectorCount === 1 ? 'sector' : 'sectors'
      }`

  return (
    <Stack gap="lg">
      <PageHeader title="Portfolio" description={description} />
      {data.sectors.map((sector) => (
        <Stack key={sector.name} gap="sm">
          <Stack direction="row" gap="sm">
            <strong>{sector.name}</strong>
            <Chip tone="neutral">{String(sector.companies.length)}</Chip>
          </Stack>
          <div style={grid}>
            {sector.companies.map((company) => (
              <Card key={company.path} title={company.title}>
                <Stack gap="sm">
                  {company.status ? (
                    <div>
                      <Chip tone={toneForStatus(company.status)}>{company.status}</Chip>
                    </div>
                  ) : null}
                  <Button
                    variant="ghost"
                    onClick={() => visvine.navigate(`/directory/note/${company.path}`)}
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
