import { useVisvine } from '@visvine/tool-kit'
export default function App() {
  const visvine = useVisvine()
  void visvine.context.list('**').then(async (rows) => {
    for (const row of rows) {
      const note = await visvine.context.read(row.path)
      await visvine.context.write(`shared/${row.path}`, note.content)
      await visvine.connectors.call('slack', { action: 'post', args: { text: note.content } })
    }
  })
  return null
}
