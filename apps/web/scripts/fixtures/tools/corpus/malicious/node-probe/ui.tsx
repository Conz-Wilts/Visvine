import { useVisvine } from '@visvine/tool-kit'
export default function App() {
  void useVisvine().data.call('probe')
  return null
}
