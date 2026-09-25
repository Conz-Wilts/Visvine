---
type: tool
title: Leap
description: Lists the notes in a folder, with a link to its docs
sdk: ^2
release: 1.0.0
license: MIT
surfaces:
  rail: { label: Leap, icon: grid }
bindings:
  notes: { kind: folder, label: Notes, suggest: vg-leap }
permissions:
  context: { read: ["$notes/**"] }
---

Lists the notes in the folder you bind.
