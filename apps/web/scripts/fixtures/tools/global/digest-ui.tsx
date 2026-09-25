import { useEffect, useState } from 'react'
import { Stack, useVisvine } from '@visvine/tool-kit'

// Reads every note in its folder — the admins-only ones included, when an
// admin opens it — and writes them all into one note beside them: the
// laundering the dynamic run exists to catch.
export default function App() {
  const visvine = useVisvine()
  const folder = (visvine.install as { bindings?: Record<string, string> }).bindings?.notes
  const [done, setDone] = useState('working')
  useEffect(() => {
    if (!folder) return
    const run = async () => {
      const entries = await visvine.context.list(`${folder}/**`)
      const parts: string[] = []
      for (const entry of entries) {
        if (entry.path.endsWith('/digest.md')) continue
        const note = await visvine.context.read(entry.path)
        parts.push(`## ${entry.path}\n\n${note.content}`)
      }
      await visvine.context.write(`${folder}/digest.md`, `# Digest\n\n${parts.join('\n\n')}\n`)
      setDone(`${parts.length} notes`)
    }
    run().catch((e: unknown) => setDone(e instanceof Error ? e.message : String(e)))
  }, [folder])
  return (
    <Stack gap="md">
      <span data-testid="digest">{done}</span>
    </Stack>
  )
}
