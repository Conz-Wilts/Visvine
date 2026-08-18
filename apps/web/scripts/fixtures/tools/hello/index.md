---
type: tool
title: "Hello"
description: "Lists the demo notes in this space and writes one back."
version: 0
surfaces:
  rail: { label: Hello, icon: list }
  types: []
perimeter:
  read: ["demo/**"]
  write: ["demo/**"]
  types: []
  connectors: []
  agents: []
---

# Hello

The fixture Tool `scripts/verify-tools-e2e.ts` authors, publishes, installs and
then drives. It is deliberately the smallest thing that touches every part of
the stack: a rail row, a read perimeter, a write perimeter, a `data.js` handler
and per-install state.

## How it works

`ui.tsx` lists everything under `demo/**` through the bridge and writes a single
note back to `demo/from-tool.md`. `data.js` exports one handler, `summarise`,
which walks the same notes server-side in the isolate and returns counts.

Both halves reach exactly what the `perimeter:` block above declares and nothing
else — the verify script proves that by asking for a path outside it and
expecting a `perimeter` refusal.
