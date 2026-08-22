---
type: tool
title: "Wayfinder"
description: "A goal, its waves and its task board — over context notes, with a Run button that dispatches an agent."
version: 0
surfaces:
  rail: { label: Wayfinder, icon: kanban }
  types: [{ type: wayfinder-project, mode: page }, { type: wayfinder-task, mode: page }]
perimeter:
  read: ["harness/**", "agents/*.md"]
  write: ["harness/**", "agents/*.md"]
  types: [wayfinder-project, wayfinder-task]
  connectors: []
  agents: ["wayfinder-*"]
---

# Wayfinder

The planning board the Visvine Tools feature was itself built with — a goal, a
plan, the waves it breaks into, and a task board over them — rebuilt as a Tool
inside Visvine. Nothing here is app code: it is one `index.md`, one `ui.tsx` and
one `data.js`, authored through the same public mechanism any member has.

## The note layout

Everything the board shows is an ordinary context note, so it has history,
grants, search and the trash like anything else in the space.

```
harness/<project>/project.md              the goal, the waves, the plan
harness/<project>/tasks/<id>-<slug>.md    one task
```

`harness/<project>/index.md` is NOT the project note. The folder index is the
human-readable home page for the project's tasks; the project note is this
Tool's own record, with this Tool's own schema. They stay separate on purpose,
and the project note sits beside the index at `project.md`.

### `project.md`

```yaml
---
type: wayfinder-project
title: "User-created Tools"
goal: "Let members build essentially anything as a Tool."
status: "active"
waves: [{ "n": 1, "title": "Foundations" }, { "n": 2, "title": "Services" }]
---

## Goal

The one-paragraph version, in the requester's own words.

## Brief

The refined goal — what a finished thing looks like.

## Plan

How the work breaks into the waves listed above.
```

### `tasks/<id>-<slug>.md`

```yaml
---
type: wayfinder-task
id: "016"
title: "MCP authoring tools"
status: "done"            # todo | doing | done | failed
size: "l"                 # xs | s | m | l | xl
wave: 3
depends_on: ["003", "010"]
touches: ["lib/mcp/appTools.ts"]
agent: "wayfinder-visvine-tools-016"     # optional, set by Run
run: { "id": "…", "status": "queued", "at": "2026-08-18T04:00:00.000Z" }
---

## Task

What to build. This is what an agent brief is written from.

## Outcome

What was built, and how it was checked. An agent run appends here.
```

## Frontmatter, without a YAML library

There is no YAML parser inside a Tool, and shipping one would be a dependency the
sandbox has no way to install. Two facts make one unnecessary:

- **Reading** — `visvine.context.read(path)` already hands back
  `frontmatter` parsed server-side with the real parser, so the Tool never parses
  anything. It only has to split the body off, which is three lines.
- **Writing** — every value is serialized as **JSON**, which is a strict subset
  of YAML 1.2. `depends_on: ["003"]` and `run: { "id": "x" }` are valid YAML
  flow collections, so what the Tool writes is exactly what Visvine's own parser
  reads back. Nothing hand-rolled sits between the two.

## Running a task

`Run` on a card writes an agent brief at `agents/wayfinder-<project>-<id>.md`
whose body is the task's `## Task` text plus instructions to append its result to
the task note under `## Outcome`, then calls `visvine.agents.run(...)`.

**Writing a brief is the one hole in a sealed namespace.** `agents/`,
`connectors/` and `tools/` are sealed against Tool writes
(`lib/tools/bridge.ts#SEALED_WRITE_DIRS`); the exception is CREATING the brief of
an agent the Tool's own perimeter names, which is why `agents: ["wayfinder-*"]`
sits above beside `write: ["agents/*.md"]`. A brief is not the thing that runs —
ACTIVATION is (`agents/live/<name>.md`, admins only), and an inactive agent
refuses to run at all. So the board can prepare the work; a person still says yes.

An existing brief is never rewritten: the instructions an admin approved are not
this board's to change. When the write is refused anyway — a viewer without edit
access in `agents/`, or a brief already sitting there — the board shows the exact
markdown for a person to save at that path rather than guessing at the reason.

## Limits

- One `data.call` reads at most 60 task notes; a larger board is truncated and
  says so.
- The board is a shared surface: two people editing the same task note last-write-
  wins, exactly as two people editing the same note anywhere else in Visvine do.
- An agent run edits **notes**, not code. It appends an outcome to the task note;
  it does not open a checkout.
