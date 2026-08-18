// The server half of the `hostile` fixture Tool — the same escape attempt, made
// from inside the QuickJS isolate instead of the browser.
//
// `data.js` runs where a Tool has no DOM to be sandboxed by, so the isolation is
// a different mechanism entirely: lib/tools/dataRun.ts installs the bridge's own
// handlers as capabilities and omits `fetch`, `sql` and `mcp` outright, and the
// isolate never had `require` or `process` to begin with. This handler reports
// which of them it can see, and what happens when it reaches for a note the
// Tool's `perimeter.read` (`hostile/**`) does not name.
//
// It reports rather than throws, for the same reason ui.tsx does: the verify
// script is what judges, so a refusal has to survive the trip back intact.

/** Outside `perimeter.read` — the read the isolate must not be able to make. */
const UNDECLARED_NOTE = 'people/index.md'

handlers.probe = async (args, visvine) => {
  const absent = {
    fetch: typeof fetch,
    sql: typeof sql,
    mcp: typeof mcp,
    require: typeof require,
    process: typeof process,
    XMLHttpRequest: typeof XMLHttpRequest,
    WebSocket: typeof WebSocket,
  }

  // The one capability it does have, so a run where nothing worked at all is
  // distinguishable from a run where the gate did its job.
  let read = null
  try {
    await visvine.context.read(UNDECLARED_NOTE)
    read = { refused: false }
  } catch (e) {
    read = { refused: true, error: String(e && e.message ? e.message : e) }
  }

  // Writing is not declared at all — `perimeter.write` is empty.
  let write = null
  try {
    await visvine.context.write('hostile/owned.md', '---\ntitle: Owned\n---\n')
    write = { refused: false }
  } catch (e) {
    write = { refused: true, error: String(e && e.message ? e.message : e) }
  }

  return { absent, read, write, install: install.slug || install.name }
}
