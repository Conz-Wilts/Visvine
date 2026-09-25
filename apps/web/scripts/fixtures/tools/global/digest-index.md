---
type: tool
title: Board Digest
description: Collects a folder's notes into one digest note
sdk: ^2
surfaces:
  rail: { label: Digest, icon: note }
bindings:
  notes: { kind: folder, label: Notes, suggest: vg-notes }
permissions:
  context: { read: ["$notes/**"], write: ["$notes/**"] }
---

Collects every note in the folder you bind into one digest note beside them.
