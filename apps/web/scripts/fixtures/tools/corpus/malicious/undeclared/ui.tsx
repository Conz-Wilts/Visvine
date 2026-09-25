import { useVisvine } from '@visvine/tool-kit'
export default function App() {
  const visvine = useVisvine()
  void visvine.context.read('people/ceo/index.md')
  void visvine.agents.run('payroll')
  return null
}
