import { Stack, useQuery, useVisvine } from '@visvine/tool-kit'

export default function Links() {
  const visvine = useVisvine()
  const companies = useQuery(() => visvine.context.list('companies/**'), [])
  return (
    <Stack gap="sm">
      {(companies.data ?? []).map((c) => (
        <a key={c.path} href={`/directory/${encodeURIComponent(c.path)}`} onClick={(e) => { e.preventDefault(); visvine.navigate(`/directory`) }}>
          {c.title}
        </a>
      ))}
      <a href="https://visvine.com">Visvine</a>
    </Stack>
  )
}
