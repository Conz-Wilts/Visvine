---
type: tool
title: Tally
description: Counts presses into a note in the folder you bind
sdk: ^2
release: 1.0.0
license: MIT
surfaces:
  rail: { label: Tally, icon: grid }
bindings:
  notes: { kind: folder, label: Tally notes, suggest: vg-tally }
permissions:
  context: { read: ["$notes/**"], write: ["$notes/**"] }
---

Counts presses into `tally.md` in the folder you bind.
