---
id: 025
title: "The Wayfinder Tool: goal/plan/waves/task board over notes with agent dispatch (source + seed)"
status: done
kind: build
size: l
wave: 5
depends_on: [016, 015, 017, 022, 018]
touches: [examples/tools/wayfinder/**, apps/web/scripts/seed-wayfinder-tool.ts, docs/wayfinder-tool.md]
created_by: 002
session: 3deb40ce-02bb-4365-832a-778373c8d0f9
model: opus
effort: xhigh
---

## Task

The acceptance test: rebuild the Wayfinder harness's planning board as a Visvine Tool, authored ONLY through the public Tool mechanism (MCP handlers + `@visvine/tool-kit`), no privileged code paths. Study `.wayfinder/tasks/*.md` (frontmatter: id, title, status, kind, size, wave, depends_on[], touches[]; body `## Task` / `## Outcome`) and `.wayfinder/tasks/plan.md` (Goal / Brief / Context / Plan) — read-only, never modify .wayfinder.

**examples/tools/wayfinder/index.md** — `type: tool`, title 'Wayfinder', description, `surfaces: { rail: { label: Wayfinder, icon: kanban }, types: [{ type: wayfinder-project, mode: page }, { type: wayfinder-task, mode: page }] }`, `perimeter: { read: ['harness/**', 'agents/*.md'], write: ['harness/**', 'agents/*.md'], types: [wayfinder-project, wayfinder-task], agents: ['wayfinder-*'] }`, docs body explaining the note layout.

**Note layout** the Tool owns: `harness/<project>/index.md` (`type: wayfinder-project`, frontmatter `goal`, `status`, `waves: [{ n, title }]`, body = Goal / Brief / Plan sections) and `harness/<project>/tasks/<id>-<slug>.md` (`type: wayfinder-task`, frontmatter id, title, status: todo|doing|done|failed, size, wave, depends_on[], touches[], agent?: name, run?: { id, status, at }; body `## Task` / `## Outcome`).

**ui.tsx** (React + tool-kit only): rail page = project list (create project: name + goal → writes index.md), project view = plan panel (goal/brief editable, waves list) + task board (columns per wave, cards with status chip/size/deps, add task, edit inline, move across waves = frontmatter rewrite, mark done), a 'Run' button on a task that (via data.js) ensures an agent brief `agents/wayfinder-<project>-<id>.md` exists (member-writable brief; body = the task's `## Task` text + instructions to append `## Outcome` to the task note; `connectors: []`, `tools: []`) and calls `visvine.agents.run(name)`, then polls the task note for the outcome; type pages: for `wayfinder-project` notes render the project view with that note as subject; for `wayfinder-task` notes render the task detail. Show a degraded banner when the `agents` requirement is unmet, and clear error cards on failure.

**data.js** handlers: `loadProject`, `saveTask`, `moveTask`, `runTask` (write brief + agents.run + record `run` in task frontmatter) — all through `visvine.context.*` / `visvine.agents.run` so the perimeter is exercised. Keep frontmatter parsing in a tiny in-Tool helper (no yaml lib inside the isolate — write a minimal parser for the flat fields you use, or store task meta as JSON in a fenced block; state your choice in docs).

**scripts/seed-wayfinder-tool.ts**: creates the Tool through `appToolHandlers` (createTool + writeTool ×3), asserts the build is ok, publishes, approves as super-admin, installs into the target space (arg or local-dev default), ensures the custom types `wayfinder-project`/`wayfinder-task` exist in the space's nodeTypes (use the same merge helper the type backfill script uses), and seeds a `harness/visvine-tools/` project mirroring THIS plan (goal, waves, a handful of tasks) so the board opens populated. Idempotent. **docs/wayfinder-tool.md**: what it proves, layout, how to run the seed, known limits (an agent run edits notes, not code). Acceptance: seed passes locally; `pnpm dev` shows the Wayfinder rail item, the board renders and a task can be moved and Run creates a brief + a run row (an agent run needs a model key — if none is configured locally, assert the brief + the run attempt/refusal path and say so); tsc/lint/knip clean (examples/ must be excluded from knip/tsc — check tsconfig `include` and knip.json; add an ignore if needed).

## Outcome

The Wayfinder harness's planning board now runs as a Visvine Tool, authored through nothing but the public mechanism: ~1,100 lines of TSX/JS in `examples/tools/wayfinder/` that go in through `appToolHandlers.createTool`/`writeTool` and reach data only through the bridge. The seed passes clean and idempotent (0 failed checks on three consecutive runs), and I drove the result in a headless browser against the running dev server: the **Wayfinder rail row** is in the sidebar, `/t/wayfinder` renders the project list, `harness/visvine-tools/project.md` renders the plan panel + six wave columns as the note's first tab, the task note renders its detail page, **moving a card between columns re-files the note and the board redraws**, Done flips the status chip, and Run behaves exactly as documented. tsc / `eslint . --max-warnings=0` / knip / 984 tests all clean.

**The acceptance test found two real walls, both recorded rather than bypassed.**

(1) **The project note is `project.md`, not `index.md`.** `enforceIndexFrontmatter` holds every note at an index path to `type: Index` — an index note *is* its folder — so no Tool can own a folder index's type. The project note sits beside the folder index instead. One word of deviation from the spec, documented with the reason.

(2) **A Tool may not write an agent brief.** `lib/tools/bridge.ts#SEALED_WRITE_DIRS` refuses every Tool write into `agents/` whatever the perimeter declares (wave 2's own security decision: a brief runs unattended on the space's model key). That directly contradicts this task's spec and the plan's Context line about Run "writing" a brief. I did NOT reach past it. `runTask` reads the brief first, and when it is missing **attempts the write anyway** so the refusal a person reads is Visvine's own, then shows the exact brief markdown to save at that path and records `run: { status: "blocked" }` on the task frontmatter. I proved the other half separately with a scratch probe: with a brief present (written by a human, then cleaned up), the call reaches `visvine.agents.run` and is refused with *"The agent must be active before it can be run — ask a space admin to activate it."* — the run attempt/refusal path the acceptance criteria anticipated. No model key is configured locally, so a run was never going to execute. **Filed as task 057 (wave 6)** to settle whether the seal narrows for a declared brief or the docs change. `agents/*.md` stays in the declared perimeter per spec; the seal outranks it, and reading is still allowed, which is what makes the difference legible.

**Frontmatter, no YAML lib** (the choice the task asked me to state): the Tool parses nothing. `context.read` already returns `frontmatter` parsed server-side with the real parser, so `data.js` only splits the body off; everything written back is serialized with `JSON.stringify`, and JSON is a strict subset of YAML 1.2 — so `depends_on: ["016","022"]` and `waves: [{"n":1,"title":"Foundations"}]` are valid YAML flow collections that Visvine's own parser reads back. Stated in `index.md` and in the docs.

**Layout the Tool owns:** `harness/<project>/project.md` (`type: wayfinder-project`; `goal`/`status`/`waves[]` + `## Goal`/`## Brief`/`## Plan`) and `harness/<project>/tasks/<id>-<slug>.md` (`type: wayfinder-task`; id/title/status/size/wave/depends_on[]/touches[]/agent?/run? + `## Task`/`## Outcome`). `data.js` handlers: `listProjects`, `createProject`, `loadProject`, `saveProject`, `loadTask`, `saveTask`, `moveTask`, `runTask` — all through `visvine.context.*` / `visvine.agents.run`. `ui.tsx` is one component switched on `visvine.subject`: null → rail page (project list + create), `wayfinder-project` → plan panel + board, `wayfinder-task` → task detail. Degraded banner (the space has no `wayfinder-*` agent, so the install IS degraded — that path is live, not hypothetical) and error cards on every mutation.

**The seed** (`scripts/seed-wayfinder-tool.ts`, defaults to `community:blackbird-ventures`) adds the two custom node types *before* installing (`resolveTypeClaims` only grants `mode: page` for a type the space already has — get this order wrong and both pages silently downgrade to tabs), writes the three files, publishes/approves/installs, then seeds `harness/visvine-tools/` — this plan's goal, six waves, twelve real tasks — **through the Tool's own data.js over the bridge**, because the point is that nothing else is needed. It then asserts the board reads back, moves a card and back, and reports the Run path. Idempotency needed one fix worth knowing: comparing the working copy against the disk files republished on every run, because the store owns a folder index's managed child block, so `tools/wayfinder/index.md` is never byte-identical to the example file — it now compares `read_tool`'s output against the newest registry version instead.

**No knip/tsconfig ignore was needed** (the task asked me to check): all three gates run inside `apps/web`, and `examples/` is at the repo root, outside every one of their globs. Verified by running them.

Left in the local dev DB on purpose, as the task asked: the `wayfinder` Tool (v2, approved, installed), the `Wayfinder-project`/`Wayfinder-task` node types and the seeded `harness/visvine-tools/` board. The scratch probe's agent brief and its state row were removed and verified gone.
