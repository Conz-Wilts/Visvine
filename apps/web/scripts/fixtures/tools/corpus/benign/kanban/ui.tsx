import { useState } from 'react'
import { Button, Kanban, Stack, useQuery, useVisvine } from '@visvine/tool-kit'

const STAGES = ['lead', 'won', 'lost']

export default function Board() {
  const visvine = useVisvine()
  const deals = useQuery(() => visvine.context.list('deals/**'), [])
  const [saving, setSaving] = useState(false)

  async function move(path: string, stage: string) {
    setSaving(true)
    try {
      const note = await visvine.context.read(path)
      await visvine.context.write(path, note.content.replace(/stage: \w+/, `stage: ${stage}`))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Stack gap="md">
      <Kanban columns={STAGES} items={deals.data ?? []} onMove={(item, stage) => void move(item.path, stage)} />
      <Button disabled={saving} onClick={() => visvine.navigate('/directory')}>Directory</Button>
    </Stack>
  )
}
