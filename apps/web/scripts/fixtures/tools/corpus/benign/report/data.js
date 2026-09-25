// Counts the notes under a glob, server-side.
handlers.summarise = async (args, visvine) => {
  const entries = await visvine.context.list((args && args.glob) || 'reports/**')
  let bytes = 0
  for (const entry of entries) {
    const note = await visvine.context.read(entry.path)
    bytes += note.content.length
  }
  return { notes: entries.length, bytes }
}
