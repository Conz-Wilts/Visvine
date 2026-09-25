import { Card, Stack, useQuery, useVisvine } from '@visvine/tool-kit'

export default function Report() {
  const visvine = useVisvine()
  const summary = useQuery(() => visvine.data.call<{ notes: number }>('summarise', { glob: 'reports/**' }), [])
  return (
    <Stack gap="md">
      <Card>{summary.data ? `${summary.data.notes} notes` : '…'}</Card>
    </Stack>
  )
}
