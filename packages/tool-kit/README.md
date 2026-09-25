# @visvine/tool-kit

The kit a [Visvine](https://visvine.com) Tool is written against.

Inside Visvine a Tool imports `@visvine/tool-kit` and the frame serves it —
there is nothing to bundle. This package carries what a Tool's own repo needs
around that:

- **Its types** — `import { useVisvine, Button } from '@visvine/tool-kit'`
  type-checks against `index.d.ts`: the bridge (`visvine.context`, `records`,
  `resources`, `collections`, `connectors`, `data`, `state`, `ai`, `ui`), the
  hooks and the components.
- **The frame's runtime** (`runtime/`) — React, the kit and its stylesheet, as
  Visvine serves them.
- **An offline runtime** (`@visvine/tool-kit/mock`) — a Tool's bridge answered
  from a `fixtures/` folder under the same permission gates Visvine applies.
  `visvine-tool dev` runs on it.

Build with [`visvine-tool`](https://www.npmjs.com/package/@visvine/tool-cli).
