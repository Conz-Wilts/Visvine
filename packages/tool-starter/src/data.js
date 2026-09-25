// Handlers the interface calls with `visvine.data.call(name, args)`. They run
// on Visvine's server in a sandbox, with the same permissions as the
// interface — and here, offline, against fixtures/.
handlers.summary = async ({ folder }, visvine) => {
  const notes = await visvine.context.list(`${folder}/**`)
  let words = 0
  for (const note of notes) {
    const { content } = await visvine.context.read(note.path)
    words += content.replace(/^---[\s\S]*?---/, '').split(/\s+/).filter(Boolean).length
  }
  return { notes: notes.length, words }
}
