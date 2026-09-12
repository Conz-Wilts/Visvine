---
type: tool
title: "Accounts Board"
description: "Every organisation the space works with, grouped by segment, read straight from the shared context notes."
version: 0
surfaces:
  rail: { label: Accounts, icon: grid }
perimeter:
  read: ["communities/**/index.md", "segments/*.md"]
  write: []
  types: []
  connectors: []
  agents: []
---

# Accounts Board

A deliberately small Tool: one read-only view over the organisation notes that
already exist under `communities/`, grouped by the segment each one declares. It
exists so the local database always has a Tool that has been through the whole
public lifecycle — authored, compiled, published, reviewed, installed — rather
than leaving the four `app_tool_*` tables empty.

Nothing here is app code. It is one `index.md`, one `ui.tsx` and one `data.js`,
written through the same mechanism any member has, and it reads through the
perimeter declared above: `communities/**/index.md` and `segments/*.md`,
read-only. It cannot write a note, reach a connector, or dispatch an agent.

## The note layout

It invents no schema — it reads the one the space already uses. An organisation
is an entity FOLDER whose index is its record (`communities/<org>/index.md`, see
lib/notes/entities.ts), and both facts the board shows live in its `tags:`:

```yaml
type: "Company"
title: "Kowhai Labs"
tags: ["accelerators-incubators", "customer", "organisation"]
#       ^ segment                 ^ relationship
```

- **Segment** is whichever tag names a real note under `segments/`. The
  vocabulary is READ from those notes rather than hardcoded, so renaming a
  segment or adding one is picked up for free, and a tag that matches no segment
  note is left alone rather than guessed at.
- **Relationship** is whichever tag is one of `customer`, `design-partner`,
  `prospect`, `investor`, `partner`.
- **Title** comes from `title:`, falling back to the slug read as words.

An organisation whose tags name no segment collects under **Unsorted**, which is
the honest place for it.

Note the read glob: a middle `**` matches zero or more segments, so
`communities/**/index.md` covers both an organisation's folder index and the
namespace's own `communities/index.md` — which is why the loader skips the
latter explicitly rather than trusting the pattern to exclude it.

`context.list` returns a note's path, title and type but not its tags, so the
segment costs one read per organisation. That caps a load at `MAX_ORGS` (200);
past that the header says the board is partial instead of quietly showing a
slice. The seeded space has 65 organisations and loads well inside the
isolate's 20 seconds.

## Why it is read-only

A `write: []` perimeter is the point. This Tool is the low-risk resident of the
seeded space, so the interesting paths it exercises are compile, publish,
review, install and the bridge's read path — not mutation. Anything that needs
to write a note should declare that reach and be reviewed for it.
