import { Button, Stack, useCollection, useCollectionCount, useVisvine } from '@visvine/tool-kit'

const CHOICES = ['a', 'b', 'c'] as const

// Everyone's tally, live; the viewer's own last votes; the rest by count.
export default function App() {
  const visvine = useVisvine()
  const tally = useCollectionCount('votes', { groupBy: 'choice' })
  const mine = useCollection<{ choice: string }>('votes', { mine: true, order: 'desc', limit: 200 })
  const notes = useCollectionCount('notes')
  const pins = useCollectionCount('pins')
  const count = (choice: string) => tally.data?.groups?.find((g) => g.value === choice)?.count ?? 0
  return (
    <Stack gap="md">
      <span data-testid="total">{tally.data ? `${tally.data.total} votes` : 'counting'}</span>
      {CHOICES.map((choice) => (
        <Stack key={choice} direction="row" gap="sm">
          <span data-testid={`tally-${choice}`}>{count(choice)}</span>
          <Button variant="secondary" onClick={() => visvine.collections.insert('votes', { choice })}>
            {`Vote ${choice.toUpperCase()}`}
          </Button>
        </Stack>
      ))}
      <span data-testid="mine">{mine.data ? `${mine.data.length} mine` : ''}</span>
      <span data-testid="notes">{notes.data?.total ?? 0}</span>
      <span data-testid="pins">{pins.data?.total ?? 0}</span>
    </Stack>
  )
}
