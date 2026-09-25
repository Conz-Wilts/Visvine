/**
 * The files a Tool author's own repo carries about the platform — generated
 * from the one source the app, the MCP server and the builder read, so they
 * never say something the server does not:
 *
 *   packages/tool-starter/AGENTS.md      the agent's manual: the repo's loop,
 *                                         then the platform guide (sdkDocs.ts)
 *   packages/tool-starter/COMPONENTS.md  the kit's catalog (catalog.ts)
 *   packages/tool-kit/index.d.ts         the kit's types, as a module
 *
 * `scripts/build-tool-packages.ts` writes them; tests/tools-starter.test.ts
 * fails when a committed copy has drifted from what this renders.
 */
import { renderCatalog } from './catalog'
import { TOOL_AUTHOR_GUIDE, TOOL_KIT_DTS } from './sdkDocs'

const GENERATED = 'Generated from the Visvine server’s own SDK docs — edits here are overwritten.'

/** The kit's ambient `declare module` block, as the package's own top-level types. */
export function renderKitDts(): string {
  const open = TOOL_KIT_DTS.indexOf("declare module '@visvine/tool-kit' {")
  const close = TOOL_KIT_DTS.lastIndexOf('}')
  if (open === -1 || close === -1) throw new Error('TOOL_KIT_DTS is not one declare module block')
  const body = TOOL_KIT_DTS.slice(TOOL_KIT_DTS.indexOf('\n', open) + 1, close)
    .split('\n')
    .map((line) => (line.startsWith('  ') ? line.slice(2) : line))
    .join('\n')
    .trim()
  return `// Type definitions for @visvine/tool-kit — the kit a Visvine Tool imports.
// ${GENERATED}
// At runtime the frame's import map serves the kit; this package carries its
// types and the offline runtime \`visvine-tool dev\` runs a Tool on.

${body}
`
}

export function renderStarterComponents(): string {
  return `<!-- ${GENERATED} -->

# The kit's components

What a Tool draws with: the app's own components and the kit's data-bound
ones, on the same tokens — so a Tool looks like the rest of Visvine by
default, and follows the viewer's theme. \`npx visvine-tool dev\` draws every
one of them under **Components**. A Tool may choose its own look when the
person it is for asks for one; these are the default, not a wall.

${renderCatalog()}
`
}

export function renderStarterAgents(): string {
  return `<!-- ${GENERATED} -->

# Building this Visvine Tool

This folder is a **Visvine Tool**: a small React app that runs inside a
Visvine space, in a sandboxed frame, and reaches the space only through what
its manifest declares. You write it here; Visvine compiles it, checks it and
runs it. Read this file before changing anything — the platform is small and
specific, and guessing it costs a round trip.

## The files

| File | What it is |
| --- | --- |
| \`visvine-tool.json\` | The manifest — what the Tool is, what it may touch, and the slots each space binds. The same keys the guide below shows as \`index.md\` frontmatter, here as JSON. |
| \`src/ui.tsx\` | The entry: \`export default\` a React component that takes no props. |
| \`src/<name>.tsx\`, \`src/<name>.ts\` | More modules — lower-case names with hyphens — imported as \`./<name>\`. |
| \`src/data.js\` | Optional handlers, run on Visvine's server in a sandbox: \`handlers.<name> = async (args, visvine) => …\`, called with \`visvine.data.call(name, args)\`. Named in the manifest as \`entry.data\`. |
| \`fixtures/\` | The offline space \`dev\` runs it in (below). Never shipped. |
| \`README.md\` | The Tool's documentation, shown on its About page. |
| \`CHANGELOG.md\` | Release notes: the newest \`## <release>\` section rides a publish. |
| \`icon.svg\` | Optional: its own sidebar glyph (set \`surfaces.rail.icon\` to \`custom\`). |

Keep \`name\` in \`visvine-tool.json\` as it is: a Tool's name is its identity in
every space, and a new name is a new Tool.

## The loop

1. **Check.** \`npx visvine-tool check\` builds the Tool with the server's own
   compiler and runs the checks a publish runs, on this machine. Fix every
   error it prints — \`file:line:col\` points at it — before anything else.
2. **Look.** \`npx visvine-tool dev\` serves it at http://localhost:4800,
   offline, in the same sandboxed frame and on the same kit it will run on in
   Visvine, answered from \`fixtures/\`. The page lists every call the Tool makes
   and how it was answered: a \`perimeter\` refusal means the manifest does not
   declare that reach — declare it, do not work around it. Switch between
   Admin and Member to see both.
3. **Ship.** \`npx visvine-tool push\` sends it to a space as its working copy
   and prints where to preview it there (\`--space <id>\`; \`npx visvine-tool
   spaces\` lists them); \`npx visvine-tool publish\` publishes a version into
   that space — approved at once for a space admin, waiting for one otherwise.
   Sign in first with \`npx visvine-tool login\`. Against a Visvine running on
   this machine, add \`--server http://localhost:3000\`.

With the Visvine MCP server connected (\`.mcp.json\`), the same acts are the
actions \`check_package\`, \`push_tool\` and \`publish_tool\`.

## Rules that matter

- **Declare before you call.** Every bridge call is checked against the
  manifest's \`permissions\` before anything is read; an undeclared call fails
  with \`perimeter\`, in \`dev\` exactly as in Visvine.
- **Bindings, not paths.** Name the kind of thing the Tool needs in
  \`bindings\` (\`{ kind: folder, suggest: board }\`) and use \`$slot\` in
  permissions; read what a space bound from \`visvine.install.bindings\`. A path
  written into the code is a path that only exists in one space.
- **Imports:** \`react\`, \`react-dom\`, \`@visvine/tool-kit\`, your own modules
  (\`./<name>\`), and the curated dependencies the manifest declares. Nothing
  else compiles; there is no npm at runtime.
- **The sandbox:** no network (\`fetch\` goes nowhere — reach a service through a
  connector), no \`localStorage\` (use \`visvine.state\` or a collection), no
  popups, no navigating the frame. Links out go through \`visvine.navigate\`
  (in-app paths only).
- **The look:** the kit's components (COMPONENTS.md) on the app's theme — flat
  surfaces, hairlines, labels of one to three words, colour only from
  \`var(--vv-*)\`. The app draws the chrome around the Tool; draw content only.

## Fixtures

\`fixtures/\` is the space \`dev\` answers from; \`push\` never sends it.

| Path | What it holds |
| --- | --- |
| \`space.json\` | \`viewer\` (\`name\`, \`isAdmin\`), the install's \`bindings\` and \`settings\`, and what the outside answers offline: \`connectors.<name>.<action>\`, \`actions.<name>\`, \`ai.complete\`. |
| \`notes/<path>.md\` | The space's notes — \`notes/board/kickoff.md\` is the note \`board/kickoff.md\`. A note with a \`type:\` is a record of that type. |
| \`resources/<path>\` | Its files — \`resources/contracts/msa.pdf\` is a file under \`resources/contracts/\`. |

What the Tool writes in \`dev\` — notes, state, collection rows — lives until
the server stops or a fixture changes.

---

# The platform guide

The guide below is the one every Visvine author reads, and it describes a
Tool as the app keeps it: \`tools/<name>/index.md\` with the manifest in its
frontmatter, beside \`ui.tsx\` and \`data.js\`. In this repo the same keys live in
\`visvine-tool.json\`, \`ui.tsx\` is \`src/ui.tsx\` and \`data.js\` is \`src/data.js\`.
The types are in \`node_modules/@visvine/tool-kit/index.d.ts\`.

${TOOL_AUTHOR_GUIDE.replace(/^# Building a Visvine Tool\n/, '')}
`
}
