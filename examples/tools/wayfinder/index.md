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

`harness/<project>/index.md` is NOT the project note. The note store holds every
`index.md` to `type: Index` — an index note *is* its folder — so a Tool can never
own a folder index's type. The project note sits beside it, at `project.md`.

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

`Run` on a card asks for an agent brief at `agents/wayfinder-<project>-<id>.md`
whose body is the task's `## Task` text plus instructions to append its result to
the task note under `## Outcome`, then calls `visvine.agents.run(...)`.

**Visvine seals `agents/` against Tool writes** — agent briefs run unattended on
the space's model key, so no Tool may author one whatever its perimeter declares
(`lib/tools/bridge.ts#SEALED_WRITE_DIRS`). The board therefore reads the brief
first, and when it is missing it shows the exact markdown for a person to save at
that path rather than pretending it wrote it. Once a brief exists and an admin has
activated it, `Run` dispatches it and records the run on the task's frontmatter.

`agents/*.md` stays in the perimeter above because that is the reach this board is
asking for; the seal outranks it. Reading a brief is allowed, and that is what
makes the difference legible instead of silent.

## Limits

- One `data.call` reads at most 60 task notes; a larger board is truncated and
  says so.
- The board is a shared surface: two people editing the same task note last-write-
  wins, exactly as two people editing the same note anywhere else in Visvine do.
- An agent run edits **notes**, not code. It appends an outcome to the task note;
  it does not open a checkout.
