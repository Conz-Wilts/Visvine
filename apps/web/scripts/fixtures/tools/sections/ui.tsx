// The interface half of the `sections` fixture Tool. It draws no tabs of its
// own — the app draws them from index.md's `surfaces.nav` — and reports what it
// was shown through per-install state, which is how the verify script reads it.
import { useEffect, useRef, useState } from 'react'
import { Button, PageHeader, Stack, useBandAction, useSection, useVisvine } from '@visvine/tool-kit'

const MARKER = 'verify-tools-shell:sections'

/** One per document: a frame that reloaded would mount under a new id. */
const MOUNT = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export default function Sections() {
  const visvine = useVisvine()
  const [section, go] = useSection()
  const [pressed, setPressed] = useState<string[]>([])
  const seen = useRef<string[]>([])

  useBandAction('new-deal', () => setPressed((list) => [...list, 'new-deal']))

  useEffect(() => {
    if (section && seen.current[seen.current.length - 1] !== section) seen.current.push(section)
    // The next change reports again, so one slow write is not worth an error card.
    visvine.state
      .set('shell', { marker: MARKER, mount: MOUNT, section, seen: [...seen.current], pressed })
      .catch(() => {})
  }, [section, pressed, visvine])

  return (
    <Stack gap="md">
      <PageHeader title={section ?? 'none'} />
      <p data-mount={MOUNT}>Mounted {MOUNT}</p>
      <Button onClick={() => go('settings')}>Open settings</Button>
      <Button onClick={() => go('nowhere')}>Open nowhere</Button>
    </Stack>
  )
}
