# The Wayfinder Tool

The acceptance test for user-created Tools: the planning board this feature was
built with — a goal, its waves, a task board over them, and a Run button that
dispatches an agent — rebuilt **as a Visvine Tool**, authored through nothing but
the public mechanism.

Source: `examples/tools/wayfinder/` (`index.md`, `ui.tsx`, `data.js`).
Seed: `apps/web/scripts/seed-wayfinder-tool.ts`.
Everything else about Tools is in [docs/tools.md](tools.md).

## What it proves

- **A member can build a real app.** ~1,100 lines of TSX and JS, no app code, no
  privileged path. The whole thing goes in through `appToolHandlers.createTool` /
  `writeTool` and out through the same bridge every installed Tool uses.
- **A Tool can own a custom type's page.** `wayfinder-project` and
  `wayfinder-task` are member-invented types; the Tool draws the page for both, so
  a project note *is* its board and a task note *is* its detail view.
- **A Tool can be the app's data layer.** No new tables: the board is context
  notes, with history, grants, search and the trash for free.
- **The perimeter is the whole story.** The Tool declares `harness/**` and
  `agents/*.md` and reaches exactly that — and one thing it declares it still may
  not have, which is the interesting part (see [Limits](#limits)).

## The note layout

```
harness/<project>/project.md              type: wayfinder-project
harness/<project>/tasks/<id>-<slug>.md    type: wayfinder-task
```

Project frontmatter carries `goal`, `status` and `waves: [{ n, title }]`; the body
carries `## Goal`, `## Brief` and `## Plan`. Task frontmatter carries `id`,
`title`, `status` (todo | doing | done | failed), `size`, `wave`, `depends_on[]`,
`touches[]`, and — once Run has been pressed — `agent` and `run: { id, status, at,
detail }`. The body carries `## Task` and `## Outcome`.

**The project note is `project.md`, not `index.md`.** This is a deviation from the
original spec, forced by a real invariant: the note store holds every note at an
index path to `type: Index` (`lib/notes/shared/indexNote.ts#enforceIndexFrontmatter`
— an index note *is* its folder), so no Tool can own a folder index's type. The
project note sits beside the folder index instead. Nothing was bypassed to find
that out, which is what an acceptance test is for.

### Frontmatter without a YAML library

A Tool cannot install a dependency, and hand-rolling a YAML parser inside the
isolate would be a second parser to disagree with Visvine's. Neither is needed:

- **Reading** — `visvine.context.read(path)` already returns `frontmatter` parsed
  server-side with the real parser. `data.js` splits the body off (three lines)
  and parses nothing.
- **Writing** — every value is serialized with `JSON.stringify`, and JSON is a
  strict subset of YAML 1.2. `depends_on: ["016","022"]` and
  `waves: [{"n":1,"title":"Foundations"}]` are valid YAML flow collections, so
  what the Tool writes is exactly what Visvine reads back.

A seeded task note, verbatim:

```yaml
---
type: "wayfinder-task"
id: "025"
title: "The Wayfinder Tool: this board"
status: "doing"
size: "l"
wave: 5
depends_on: ["016","022"]
touches: ["examples/tools/wayfinder/**","scripts/seed-wayfinder-tool.ts"]
---
```

## The three surfaces

One component, switched on `visvine.subject`:

| Subject | Surface |
| --- | --- |
| `null` (the rail page, `/t/wayfinder`) | Every project in the space, and a form to create one |
| a `wayfinder-project` note | That project's plan panel + task board |
| a `wayfinder-task` note | One task: status, deps, `## Task`, `## Outcome`, Run |

The board is one column per wave. A card carries a status chip, its size, its
wave and its dependencies, and offers Edit (inline), Done, Run, Open, and a
select that moves it to another wave — which is a frontmatter rewrite through
`moveTask`, nothing more.

`data.js` handlers: `listProjects`, `createProject`, `loadProject`, `saveProject`,
`loadTask`, `saveTask`, `moveTask`, `runTask`. Every one of them reaches Visvine
only through `visvine.context.*` and `visvine.agents.run`, so the perimeter is
exercised on every call.

## Running the seed

```bash
pnpm --filter @visvine/web exec tsx scripts/seed-wayfinder-tool.ts [spaceId]
```

Defaults to `community:blackbird-ventures`, the local dev space. Local only
(guarded like every `db:*` script); if the local `.env` still carries a
`CLOUD_SQL_CONNECTION_NAME` from a `pnpm dev:cloud` session, clear it for the
run: `CLOUD_SQL_CONNECTION_NAME= pnpm …`.

It does not need `pnpm dev` — everything is in-process. In order it:

1. adds the `wayfinder-project` / `wayfinder-task` node types (before the install:
   `resolveTypeClaims` only grants `mode: page` for a type the space already has);
2. `create_tool` + `write_tool` ×3 from `examples/tools/wayfinder/`, and asserts
   the working copy compiles;
3. publishes, unless the newest version already carries these sources, and
   approves whatever is pending as a super admin;
4. installs, or applies the upgrade an existing install was offered;
5. seeds `harness/visvine-tools/` — this plan's own goal, six waves and twelve
   tasks — **through the Tool's own `data.js`**, over the bridge, because the point
   is that nothing but the public mechanism is needed;
6. moves a card between columns and back;
7. presses Run on task 025 and reports exactly what happened.

Idempotent: re-running it is how you pick up an edit to the example sources.

Then start `pnpm dev` and open the **Wayfinder** rail row, or go straight to
`/directory/note/harness/visvine-tools/project.md`.

## Limits

**A Tool may not write an agent brief.** `agents/`, `connectors/` and `tools/` are
sealed against Tool writes whatever a perimeter declares
(`lib/tools/bridge.ts#SEALED_WRITE_DIRS`) — an agent brief runs unattended on the
space's model key, so a Tool that could author one could grant itself reach no
reviewer ever saw. Run therefore:

1. reads `agents/wayfinder-<project>-<id>.md` (reads are not sealed);
2. if it is missing, **attempts the write anyway**, so the refusal a person reads
   is Visvine's own and not this Tool's guess at it, and shows the exact brief
   markdown for them to save at that path;
3. once a brief exists, calls `visvine.agents.run(...)`;
4. records whatever happened on the task's own frontmatter, so the board still
   says so after a reload.

`agents/*.md` stays in the declared perimeter because that is the reach this board
is asking for. The seal outranks it. This is the one place where the acceptance
test found a wall rather than a path, and it is recorded rather than papered over.

**An agent run is still two human acts away.** Activating an agent
(`agents/live/<name>.md`) is a space admin's decision, and a run needs the space's
own model key. With a brief present but inactive, `agents.run` answers *"The agent
must be active before it can be run — ask a space admin to activate it."* — which
is what the board shows.

**An agent run edits notes, not code.** The brief tells the agent to append its
result to the task note under `## Outcome`. It has no checkout, no shell and no
way to change this repository; a Visvine agent runs against the space's context
with its declared connector reach and nothing else.

**Other limits.** One `loadProject` reads at most 60 task notes (the isolate has
20 seconds and each read is a round trip); a bigger board comes back truncated and
says so. `listProjects` reads one `context.list`, capped at 200 rows like every
bridge list. After a run is queued the board re-reads the task note ten times at
six-second intervals and then stops. Two people editing one task note is
last-write-wins, exactly as it is for any note in Visvine.

## Verified

Against the local Docker DB and a `pnpm dev` server on :3000:

- the seed runs clean and is idempotent — a second run publishes nothing, installs
  nothing and creates no duplicate notes (`0 check(s) failed` both times);
- the compiled bundle is 44,067 bytes and `check_tool` reports the intended reach
  and both page claims;
- **rail row** — `/t/wayfinder` is in the sidebar and renders the project list;
- **project page** — `/directory/note/harness/visvine-tools/project.md` renders the
  plan panel and six wave columns as the note's first tab;
- **task page** — the task note renders the detail view, including the recorded run;
- **a card moves** — changing a card's wave select re-files the note and the board
  redraws with the card in the new column; **Done** flips the status chip;
- **Run** — with no brief, the sealed-namespace refusal comes back and is recorded
  as `run: { status: "blocked" }`; with a brief present (written by a human), the
  call reaches `agents.run` and is refused with *"The agent must be active…"*.
  No model key is configured locally, so the run itself was never expected to
  execute — the dispatch path is what is asserted.
