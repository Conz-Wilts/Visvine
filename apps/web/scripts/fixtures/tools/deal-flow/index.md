---
type: tool
title: Deal Flow
description: Deals by stage, in whatever folder and type a space keeps them
sdk: ^2
surfaces:
  rail: { label: Deal Flow, icon: kanban }
bindings:
  deals: { kind: folder, label: Deal notes, suggest: vf-deals }
  deal: { kind: type, label: Deal type, suggest: VfDeal, fields: [stage] }
permissions:
  context: { read: ["$deals/**"], write: ["$deals/**"] }
  records: { read: [$deal], write: [{ type: $deal, fields: [stage] }] }
  actions: [list_events]
  ui: { download: true }
settings:
  currency: { type: string, label: Currency, enum: [USD, EUR], default: USD }
dependencies: { date-fns: ^4 }
---

Deals by stage. Bind it to the folder and the type your space keeps deals in.
