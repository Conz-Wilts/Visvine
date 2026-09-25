import { Card, Stack, useQuery, useSubject, useVisvine } from '@visvine/tool-kit'

export default function CompanyCard() {
  const visvine = useVisvine()
  const subject = useSubject()
  const path = subject?.path ?? null
  const note = useQuery(() => (path ? visvine.context.read(path) : Promise.resolve(null)), [path])
  const crm = useQuery(
    () => (subject ? visvine.connectors.call('hubspot', { action: 'company', args: { name: subject.title } }) : Promise.resolve(null)),
    [subject?.title],
  )
  return (
    <Stack gap="sm">
      <Card>{note.data?.content.slice(0, 200)}</Card>
      <Card>{JSON.stringify(crm.data ?? {})}</Card>
    </Stack>
  )
}
