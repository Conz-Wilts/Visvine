---
id: 022
title: "Data-driven type pages: Tool-owned page for custom types, extra tab on built-ins"
status: todo
kind: build
size: l
wave: 4
depends_on: [012, 014, 017, 019]
touches: [apps/web/lib/tools/typePages.ts, "apps/web/app/(auth)/directory/note/[...path]/page.tsx", "apps/web/app/(auth)/directory/[nodeId]/page.tsx", apps/web/features/admin/components/TypesPanel.tsx, apps/web/features/tools/components/TypePageTab.tsx, apps/web/features/tools/hooks/useTypePages.ts, apps/web/tests/tools-type-pages.test.ts]
created_by: 002
session: null
model: null
effort: null
---

## Task

Surface (b): the profiles/spaces/events analogy for member-invented types.

**lib/tools/typePages.ts** (pure, tested): `BUILT_IN_TYPES` (person, space, event, resource, section, channel, connector, agent, tool, index + synonyms via `entityKindOf`), `resolveTypePage(installedTools: InstalledToolDto[], typeName: string): { owner: { slug; title; key } ; mode: 'page' } | { owner; mode: 'tab' } | null` — built-ins can only yield `tab`; custom types yield `page` for the ONE install whose `typeClaims[type] === 'page'` (ties impossible by construction; if data is inconsistent pick the earliest install and log), `typePagesFor(installedTools): Record<string, …>`, `noteTypeOf(frontmatter): string|null` (lower-cased `type:`).

**features/tools/hooks/useTypePages.ts**: memoised map from `useSpace().currentSpace.installedTools`.

**Note route** (directory/note/[...path]/page.tsx): after resolving the note (you need its frontmatter type — the shell's note surface loads content; find the cheapest existing hook to read the note's frontmatter, e.g. the same fetch NoteContextPanel/`useNote`-style hook uses, or add a light `GET /api/notes/item` read; do not add a new route unless unavoidable), if `resolveTypePage(...)` returns `page` for a non-entity note: tabs become `[{ id:'tool', label: <Type name> }, Context, Raw]`, default active `tool`; when active the page renders `<TypePageTab>` as the page BODY (a `ToolFrame` with `subject = { kind:'note', path, type, title }` and `mode='page'`) while registering `surface: { kind: 'tree-only', notePath }` so the docked tree stays and no note editor is drawn underneath; Context/Raw switch back to the normal note surface. Nothing changes for notes of unclaimed types.

**NodeRoute** ([nodeId]/page.tsx): for built-in entity pages that use `NodePage`/`useEntityChrome` (person, space record, org, resource, connector, agent, tool), when a Tool holds a `tab` claim for that node's type, append a tab `{ id: 'tool:<slug>', label: <tool title> }` after the first tab and before Context/Raw; selecting it renders `<TypePageTab>` with `subject = { kind:'node', nodeId, type, notePath }`. Keep this minimal and generic (one helper that appends tool tabs to a tabs array + one render branch), avoid touching Person/Event redirect logic beyond adding the tab where the tab bar already exists. Person profile uses `PERSON_TABS` — extend the same way.

**TypesPanel.tsx**: show, per custom type, which installed Tool pages it (or '—'), and when more than one install claims `page` for the same type, a picker that PATCHes `typeClaims` on the chosen install (and clears the others) via `/api/communities/[spaceId]/tools/[installId]`. Acceptance: tsc/lint/test/knip clean; manual check with a scaffold Tool claiming a custom type `deal` and a note `deals/acme.md` with `type: deal` (report).
