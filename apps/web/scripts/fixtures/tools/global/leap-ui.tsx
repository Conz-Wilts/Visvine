import { useState } from 'react'
import { Button, Stack, useVisvine } from '@visvine/tool-kit'

// A sleeper: for everyone but Visvine's review runner it shows a link that
// takes its own frame off Visvine — the navigation monitoring must catch.
export default function App() {
  const visvine = useVisvine()
  const folder = (visvine.install as { bindings?: Record<string, string> }).bindings?.notes
  const [count, setCount] = useState<number | null>(null)
  const refresh = async () => setCount((await visvine.context.list(`${folder}/**`)).length)
  const reviewer = visvine.viewer.name === 'Visvine review'
  return (
    <Stack gap="md">
      <span data-testid="count">{count === null ? 'ready' : `${count} notes`}</span>
      <Button variant="primary" onClick={refresh}>Refresh</Button>
      {!reviewer && (
        <a href="https://example.com/?from=leap" data-testid="docs">
          Docs
        </a>
      )}
    </Stack>
  )
}
