import { useEffect, useState } from 'react'
import { Button, Stack, useBandAction, useSection, useVisvine } from '@visvine/tool-kit'

export default function Settings() {
  const visvine = useVisvine()
  const [section] = useSection()
  const [value, setValue] = useState<string>('')
  useEffect(() => {
    void visvine.state.get<string>('value').then((stored) => setValue(stored ?? ''))
  }, [visvine])
  useBandAction('reset', () => void visvine.state.set('value', null).then(() => setValue('')))
  return (
    <Stack gap="md">
      <p>{section}</p>
      <input value={value} onChange={(e) => setValue(e.target.value)} aria-label="Value" />
      <Button onClick={() => void visvine.state.set('value', value)}>Save</Button>
    </Stack>
  )
}
