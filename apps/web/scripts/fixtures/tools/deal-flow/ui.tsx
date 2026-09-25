import { useState } from 'react'
import { format } from 'date-fns'
import { Banner, Button, Chip, Row, Spinner, Stack, Table, useQuery, useVisvine } from '@visvine/tool-kit'
import { money } from './src/format'

export default function App() {
  const visvine = useVisvine()
  const install = visvine.install as { bindings?: Record<string, string>; settings?: Record<string, unknown> }
  const type = install.bindings?.deal
  const currency = String(install.settings?.currency ?? 'USD')
  const [remembered, setRemembered] = useState<string | null>(null)
  const records = useQuery(() => (type ? visvine.records.query(type) : Promise.resolve(null)), [type])

  if (!type) return <Banner tone="warn" title="Deal type is not bound" />
  if (records.loading) return <Spinner />
  if (records.error) return <Banner tone="danger" title="Could not load">{records.error.message}</Banner>
  const rows = records.data?.rows ?? []

  const remember = async () => {
    const before = await visvine.state.get<string>('last')
    await visvine.state.set('last', 'seen')
    setRemembered(before ?? 'none')
  }

  return (
    <Stack gap="md">
      <Row gap={2}>
        <Chip tone="accent">{type}</Chip>
        <span data-testid="summary">{rows.length} deals · {currency} · {format(new Date(0), 'yyyy')}</span>
        <Button variant="primary" onClick={remember}>Remember</Button>
      </Row>
      {remembered && <span data-testid="remembered">{remembered}</span>}
      <Table
        columns={[
          { key: 'title', header: 'Deal', render: (r) => r.title },
          { key: 'stage', header: 'Stage', render: (r) => String(r.fields.stage ?? '') },
          { key: 'amount', header: 'Amount', render: (r) => money(Number(r.fields.amount ?? 0), currency) },
        ]}
        rows={rows}
        rowKey={(r) => r.path}
      />
    </Stack>
  )
}
