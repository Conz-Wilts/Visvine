// The server-side half of the `hello` fixture Tool. This runs in the QuickJS
// isolate (lib/tools/dataRun.ts) as a plain script — no imports, no exports, no
// network of its own. `visvine` is the same bridge the interface uses, so this
// handler reaches exactly what index.md's `perimeter:` block declares.

const DEFAULT_GLOB = 'demo/**'

handlers.summarise = async (args, visvine) => {
  const glob = (args && args.glob) || DEFAULT_GLOB
  const entries = await visvine.context.list(glob)

  const byType = {}
  let bytes = 0
  for (const entry of entries) {
    const type = entry.type || 'untyped'
    byType[type] = (byType[type] || 0) + 1
    // Reading each one proves the isolate goes through the SAME perimeter gate
    // the frame does — an undeclared path is refused here too.
    const note = await visvine.context.read(entry.path)
    bytes += note.content.length
  }

  return { glob, notes: entries.length, bytes, byType }
}
