---
type: tool
title: "Hello"
description: "Lists the demo notes in this space and writes one back."
version: 1
surfaces:
  rail: { label: Hello, icon: list }
  types: []
perimeter:
  read: ["demo/**", "people/**"]
  write: ["demo/**"]
  types: []
  connectors: []
  agents: []
---

# Hello

Version 2 of the fixture Tool: the same interface, with `people/**` added to the
read perimeter. It exists so `scripts/verify-tools-e2e.ts` can publish a second
version whose reach is strictly WIDER than the installed one, and assert that
the install is offered it as an upgrade with `perimeterDiff.read.added` naming
the new glob — the thing an admin is actually being asked to approve.

## How it works

Identical to version 1 (`ui.tsx` and `data.js` are unchanged); only the
`perimeter.read` line differs.
