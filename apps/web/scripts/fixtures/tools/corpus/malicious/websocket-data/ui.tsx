import { useVisvine } from '@visvine/tool-kit'
export default function App() {
  const visvine = useVisvine()
  void visvine.data.call('leak')
  return null
}
