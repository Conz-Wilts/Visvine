---
type: tool
title: "Portfolio Board"
description: "The space's portfolio companies, grouped by sector, read straight from the shared context notes."
version: 0
surfaces:
  rail: { label: Portfolio, icon: grid }
perimeter:
  read: ["communities/*.md", "sectors/*.md"]
  write: []
  types: []
  connectors: []
  agents: []
---

# Portfolio Board

A deliberately small Tool: one read-only view over the notes that already exist
in `communities/`, grouped by the `sector:` each one declares. It exists so the
local database always has a Tool that has been through the whole public
lifecycle — authored, compiled, published, reviewed, installed — rather than
leaving the four `app_tool_*` tables empty.

Nothing here is app code. It is one `index.md`, one `ui.tsx` and one `data.js`,
written through the same mechanism any member has, and it reads through the
perimeter declared above: `communities/*.md` and `sectors/*.md`, read-only. It
cannot write a note, reach a connector, or dispatch an agent.

## The note layout

It invents no schema — it reads the one the space already uses. A portfolio
company is an ordinary context note at `communities/<company>.md`, and both
facts the board shows live in its `tags:`:

```yaml
type: "Company"
title: "Halter"
tags: ["agtech-food", "active", "portfolio", "company"]
#       ^ sector      ^ status
```

- **Sector** is whichever tag names a real note under `sectors/`. The
  vocabulary is READ from those notes rather than hardcoded, so renaming a
  sector or adding one is picked up for free, and a tag that matches no sector
  note is left alone rather than guessed at.
- **Status** is whichever tag is one of `active`, `onboarding`, `exit`,
  `exits`, `ipo`, `written-off`.
- **Title** comes from `title:`, falling back to the slug read as words.

A company whose tags name no sector collects under **Unsorted**, which is the
honest place for it.

`context.list` returns a note's path, title and type but not its tags, so the
sector costs one read per company. That caps a load at `MAX_COMPANIES` (200);
past that the header says the board is partial instead of quietly showing a
slice. The seeded Blackbird space has 184 companies and loads in ~240ms.

## Why it is read-only

A `write: []` perimeter is the point. This Tool is the low-risk resident of the
seeded space, so the interesting paths it exercises are compile, publish,
review, install and the bridge's read path — not mutation. Anything that needs
to write a note should declare that reach and be reviewed for it.
