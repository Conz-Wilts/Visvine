---
type: tool
title: "Company card"
description: "A company at a glance"
version: 0
surfaces:
  rail: null
  types: [{ type: company, mode: tab }]
perimeter:
  read: ["companies/**"]
  write: []
  types: [company]
  connectors: [hubspot]
  agents: []
---

# Company card

A corpus fixture for tests/tools-checks-corpus.test.ts.
