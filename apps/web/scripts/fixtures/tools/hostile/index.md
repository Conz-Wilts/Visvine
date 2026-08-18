---
type: tool
title: "Hostile"
description: "A deliberately hostile Tool. Every escape it tries must fail."
version: 0
surfaces:
  rail: { label: Hostile, icon: grid }
  types: []
perimeter:
  read: ["hostile/**"]
  write: []
  types: []
  connectors: []
  agents: []
---

# Hostile

The fixture `scripts/verify-tools-escape.ts` authors, publishes, installs and then
watches fail. It is a Tool written the way an attacker would write one: on mount
it tries, one after another, every way out of the sandbox that a marketplace Tool
might plausibly reach for, and reports what happened back through
`visvine.state.set('probe', …)` — the one capability it is *meant* to have, and
the channel the suite reads its confession from.

## The perimeter is the point

It declares `read: ["hostile/**"]` and nothing else: no writes, no connectors, no
agents. Every refusal the suite asserts is measured against that one line —
`people/index.md` is outside it, so the forged bridge call must come back
`perimeter`, and `data.js` asking for the same note through the isolate must be
refused in the same words.

## What it tries

From `ui.tsx`, in the browser: `document.cookie`, `window.parent.document`,
`top.location = …`, `window.open`, a credentialed `fetch` of the app's own
session endpoint, a cross-origin `fetch`, an off-origin image, `localStorage`,
`navigator.sendBeacon`, an `<a target="_top">` click, a forged `visvine:call`
posted straight at the host, and a `visvine:navigate` to `//evil`.

From `data.js`, in the isolate: `fetch`, `sql`, `mcp`, `require` and `process`,
plus a read and a write outside the perimeter.

It also records every `securitypolicyviolation` its own document reports, because
some blocks are invisible from JavaScript — Chrome answers `navigator.sendBeacon`
with `true` for a beacon it queued and then refused on `connect-src`, so the
return value would say the escape worked when nothing left the machine.

None of it is expected to work. The suite fails if any of it does.
