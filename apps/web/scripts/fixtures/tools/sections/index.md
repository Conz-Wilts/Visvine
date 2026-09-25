---
type: tool
title: "Sections"
description: "Three sections and a band button, drawn by the app."
version: 0
surfaces:
  rail: { label: Sections, icon: list }
  types: []
  nav:
    style: tabs
    sections:
      - { id: board, label: Board }
      - { id: table, label: Table }
      - { id: settings, label: Settings, admin: true }
  actions:
    - { id: new-deal, label: New deal }
perimeter:
  read: []
  write: []
  types: []
  connectors: []
  agents: []
---

# Sections

The fixture `scripts/verify-tools-shell.ts` has a member publish from its Tool
tab, an admin approve and install through the install sheet, and then switches
between its three sections on the band. It reports what it saw through
`visvine.state.set('shell', …)`: the id of the one document it mounted in, every
section it was shown, and every band button pressed. A section change that
reloaded the frame would show up as a second mount id.
