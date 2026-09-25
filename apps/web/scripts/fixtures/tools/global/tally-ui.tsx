import { useState } from 'react'
import { Button, Stack, useVisvine } from '@visvine/tool-kit'

export default function App() {
  const visvine = useVisvine()
  const folder = (visvine.install as { bindings?: Record<string, string> }).bindings?.notes
  const [count, setCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const press = async () => {
    try {
      await visvine.context.write(`${folder}/tally.md`, `# Tally\n\n${count + 1} presses\n`)
      setCount((c) => c + 1)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  return (
    <Stack gap="md">
      <span data-testid="count">{count}</span>
      {error && <span data-testid="error">{error}</span>}
      <Button variant="primary" onClick={press}>ADD_LABEL</Button>
    </Stack>
  )
}
