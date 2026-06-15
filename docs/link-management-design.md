# Visvine Link Management — Architecture Recommendation

> Research + design for managing links (graph edges) between nodes: both **auto-created**
> (RSVP → `attended`, event create → `hosting`, intro accept → `introduced`) and
> **manually created** by users (drag-to-connect on the graph + right-click "Connect to…").
> Produced via multi-agent research; all load-bearing facts verified against source.

## 1. TL;DR

- **One gesture, one zone:** manual links are created by **dragging from a hover-revealed connect handle** on a node (not whole-node drag, not a Shift chord). Body-drag stays move; handle-drag connects. Keeps the delicate frozen-sim move-drag code (`CustomForceGraph.tsx` ~655–808) unchanged and needs no modifier in the common case. Shift+body-drag is an optional power fallback.
- **Drop = pick a type, fast:** the drop opens a **lightweight type picker** at the drop point listing the community's configured link types, pre-selected to the last-used type — one click/Enter confirms. The off-screen escape hatch is a **right-click "Connect to…" typeahead**, reachable on the graph *and* on profiles, cards, and directory rows.
- **Link types are community-configured (admin-owned), mirroring node types:** add a `Community.linkTypes` JSON column managed in the console (a sibling of the existing "Types & Aliases" tab, `TypesTab.tsx`). Each link type carries `{ name, color, directed }`; the admin chooses the type on every manual link. `DEFAULT_LINK_TYPES` is the seeded fallback (incl. the `system` types the auto-flows depend on).
- **One write path:** every edge — the 3 auto triggers, the manual POST, the MCP tool, and bulk import — flows through a single `lib/graph/links.ts` `upsertLink()` / `removeLink()`. This collapses today's four divergent dedup notions and fixes the latent `ON CONFLICT` bug.
- **Provenance is a real column, not metadata:** add `origin` + `createdBy` + `updatedAt`. Auto edges render dashed/muted; manual edges render solid in their **link-type color**. Admins can force-remove either.
- **Dedup identity = `(communityId, pairKey, relationship)` WITHOUT `origin`.** `pairKey` is an app-computed normalized `min|max` of the two node ids (a normal Prisma column, *not* a Postgres GENERATED column). When a manual link duplicates an auto one, the auto row is **promoted in place** (origin flips to `manual`) — one row, no merge/suppression subsystem.
- **Member-friendly, server-safe:** keep the `isAdmin` gate as the default (matches the repo), structured as a one-line predicate so "members may link from their own person node" is a trivial later flip. Web-only; zero mobile contract impact.

**Decisions resolved between proposals.** Two proposals put `origin` *in* the unique key (two coexisting rows → a render-merge + suppression subsystem); one keeps `origin` *out* and promotes in place. **Decision: origin out + promote in place** — removes an entire reconciliation/styling-precedence subsystem. One proposal wanted a Postgres GENERATED `pairKey`. **Decision: app-computed `pairKey`** — a GENERATED column fights `prisma db push` for the same identity.

## 2. Data model

Current `Link` (verified, `apps/web/prisma/schema.prisma:81-98`): int autoincrement PK, `sourceId`/`targetId`, free-string `relationship`, `since String?`, `metadata Json`, nullable `communityId`, `createdAt` — **no unique constraint, no `origin`, no `createdBy`, no `updatedAt`**. Links are stored once (not doubled) and read undirected.

### schema.prisma delta

```prisma
model Link {
  id           Int        @id @default(autoincrement())
  sourceId     String     @map("source_id")
  targetId     String     @map("target_id")
  relationship String
  since        String?
  metadata     Json       @default("{}")
  communityId  String?    @map("community_id")
  createdAt    DateTime   @default(now()) @map("created_at")
  // ── NEW ──
  origin       String     @default("manual") @map("origin")    // manual | event_attendance | event_hosting | intro | import
  originRef    String?    @map("origin_ref")                   // Attendee.id / IntroRequest.id / event node id — for symmetric auto-undo
  createdBy    String?    @map("created_by")                   // userId for manual; null for system/auto
  updatedAt    DateTime   @updatedAt @map("updated_at")
  pairKey      String     @map("pair_key")                     // normalized "minId|maxId" — app-computed in upsertLink

  community    Community? @relation(fields: [communityId], references: [id], onDelete: Cascade)
  source       Node       @relation("SourceNode", fields: [sourceId], references: [id], onDelete: Cascade)
  target       Node       @relation("TargetNode", fields: [targetId], references: [id], onDelete: Cascade)

  @@unique([communityId, pairKey, relationship], name: "link_identity")  // dedup; origin deliberately NOT in the key
  @@index([sourceId])
  @@index([targetId])
  @@index([communityId])
  @@index([pairKey])
  @@map("links")
}
```

**Directionality.** Keep columns directed (`sourceId`/`targetId` preserve caller direction so `attended`/`hosting` read source→target), but **dedup undirected** via `pairKey = [sourceId, targetId].sort().join('|')`. The app already reads links undirected (`mutuals.ts`, the `nodes/[nodeId]` self-join, intro bidirectional dedup) and `LinkRenderer.ts:60,116` *already* computes the identical lexicographic `min|max` pairKey for parallel-edge curves — so the DB identity matches what app and renderer already trust. A naive `@@unique([communityId, sourceId, targetId, relationship])` would miss the reversed A→B / B→A duplicate. Direction per relationship lives in a code registry (`lib/graph/relationships.ts`), not a column.

**Why `origin` is NOT in the unique key.** Including it lets a manual `related` and an auto `attended` coexist as two rows for the same pair+relationship and forces a render-time merge + suppression tombstone. Excluding it means exactly **one** row per `(community, unordered pair, relationship)`; a manual upsert *promotes* the existing auto row in place. Different relationships between a pair still coexist (`introduced` + `works_at` = two rows) and render as the existing parallel-edge fan.

### Community-configured link types (mirrors node types)

Link types are **admin-configured per community**, exactly like node types are today (`Community.nodeTypes` / `communityAliases`, edited in `TypesTab.tsx`, saved via `PUT /api/data/communities`). Add a parallel column + type + default + console UI:

```prisma
// Community model — NEW column alongside nodeTypes / communityAliases
linkTypes Json? @default("[ … DEFAULT_LINK_TYPES … ]") @map("link_types")
```

```ts
// lib/types.ts — mirror of NodeTypeConfig
export interface LinkTypeConfig {
  name: string;        // e.g. "Knows", "Works at", "Mentors", "Related"
  color: string;       // hex, used to tint the edge stroke
  directed: boolean;   // arrowhead vs plain line
  system?: boolean;    // attended | hosting | introduced — auto-flows depend on these; admin can recolor but not delete
}
export const DEFAULT_LINK_TYPES: LinkTypeConfig[] = [
  { name: 'Related',    color: '#94a3b8', directed: false },
  { name: 'Knows',      color: '#2563eb', directed: false },
  { name: 'Works at',   color: '#9333ea', directed: true  },
  { name: 'Mentors',    color: '#16a34a', directed: true  },
  { name: 'Partner',    color: '#f59e0b', directed: false },
  { name: 'Attended',   color: '#ef4444', directed: true, system: true },
  { name: 'Hosting',    color: '#ef4444', directed: true, system: true },
  { name: 'Introduced', color: '#0ea5e9', directed: false, system: true },
];
export function getLinkTypes(communityLinkTypes?: LinkTypeConfig[]): LinkTypeConfig[] {
  return communityLinkTypes?.length ? communityLinkTypes : DEFAULT_LINK_TYPES;
}
```

Wiring (each is a one-line mirror of the existing `nodeTypes` handling): add `linkTypes` to the `Community` interface; add `linkTypes: community.linkTypes as object ?? null` to the POST/PUT `data:` blocks and the GET `select:` in `app/api/data/communities/route.ts`; the existing `saveCommunity()` in `TypesTab.tsx` already spreads `...currentCommunity`, so a sibling "Link types" section there persists with zero new endpoint. `lib/graph/relationships.ts` `normalize()` keys off this list (slugifies `name` → stored `relationship` string), falling back to `DEFAULT_LINK_TYPES`. The stored `Link.relationship` stays a slug string (`works_at`); the human label + color come from the community's `linkTypes`. `system: true` types are recolor-only in the console (delete disabled) so the auto-flows never reference a removed type.

### Migration mechanics (db push, not migrate)

Add a new SQL block to `scripts/apply-sql-functions.mjs` (its `files` list is currently empty — `create_match_nodes_function.sql` was removed with semantic search — so this would be its first entry). Because the table has **never** had a unique constraint, real data may contain true duplicates *and* reversed pairs — `db push` will fail to create `link_identity` until they're collapsed. Ordered runbook:

1. `ALTER TABLE links ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'manual', ADD COLUMN IF NOT EXISTS origin_ref text, ADD COLUMN IF NOT EXISTS created_by text, ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN IF NOT EXISTS pair_key text;`
2. Backfill: `UPDATE links SET pair_key = LEAST(source_id, target_id) || '|' || GREATEST(source_id, target_id), origin = CASE relationship WHEN 'attended' THEN 'event_attendance' WHEN 'hosting' THEN 'event_hosting' WHEN 'introduced' THEN 'intro' ELSE 'manual' END WHERE pair_key IS NULL;`
3. **Collapse duplicates before the index** (merge rule: keep lowest `id`; a manual/curated row wins origin over an auto row; union `metadata`): delete the losers within each `(community_id, pair_key, relationship)` group.
4. `pnpm db:migrate` (db push materializes `link_identity`; the SQL hook runs after).

The raw `$executeRaw` in `updateCommunityGraphData` (`eventRepo.ts:650-657`) must add `pair_key`, `origin`, and `updated_at` to its column list (`@updatedAt` is client-only and won't populate raw inserts).

## 3. One link-creation path

New file `apps/web/lib/graph/links.ts`:

```ts
export type LinkOrigin = 'manual'|'event_attendance'|'event_hosting'|'intro'|'import';

export async function upsertLink(a: {
  communityId: string; sourceId: string; targetId: string; relationship: string;
  origin: LinkOrigin; since?: string|null; metadata?: object;
  createdBy?: string|null; originRef?: string|null;
}) {
  const relationship = normalize(a.relationship);
  const pairKey = [a.sourceId, a.targetId].sort().join('|');
  // PROMOTION: a manual write adopts an existing auto row in place; an auto write never overwrites a manual row.
  return prisma.link.upsert({
    where: { link_identity: { communityId: a.communityId, pairKey, relationship } },
    create: { sourceId: a.sourceId, targetId: a.targetId, relationship, pairKey,
              origin: a.origin, communityId: a.communityId, since: a.since ?? null,
              metadata: a.metadata ?? {}, createdBy: a.createdBy ?? null, originRef: a.originRef ?? null },
    update: a.origin === 'manual'
      ? { origin: 'manual', createdBy: a.createdBy, metadata: a.metadata ?? undefined, since: a.since ?? undefined }
      : { metadata: a.metadata ?? undefined, since: a.since ?? undefined }, // auto: refresh status only, never touch origin
  });
}

export async function removeAutoLink(communityId: string, origin: LinkOrigin, originRef: string) {
  // origin-scoped: structurally cannot delete a manual/curated edge (incl. a promoted one)
  await prisma.link.deleteMany({ where: { communityId, origin, originRef } });
}

export async function removeLink(communityId: string, sourceId: string, targetId: string, relationship?: string) {
  const pairKey = [sourceId, targetId].sort().join('|');
  await prisma.link.deleteMany({ where: { communityId, pairKey, ...(relationship ? { relationship: normalize(relationship) } : {}) } });
}
```

The Prisma `upsert` is a real `ON CONFLICT (community_id, pair_key, relationship)`, eliminating all three hand-rolled findFirst-then-create races and the intros concurrency hazard.

**Wire all five sites:**

| Trigger | Site | Call |
|---|---|---|
| RSVP → `attended` | `eventRepo.ts:405` `ensureAttendedLink` | `upsertLink({ origin:'event_attendance', relationship:'attended', originRef: attendeeId, metadata:{status} })` — fixes today's missing-communityId dedup |
| event create → `hosting` | `app/api/events/route.ts:85` | `upsertLink({ origin:'event_hosting', relationship:'hosting', originRef: eventId, metadata:{role:'host'} })` — adds missing `revalidateTag` |
| intro accept → `introduced` | `lib/intros/service.ts:277` `connectNodes` | `upsertLink({ origin:'intro', relationship:'introduced', originRef: introRequestId })` |
| manual create | `app/api/data/links/route.ts:69` (replace blind `prisma.link.create`) | `upsertLink({ origin:'manual', createdBy: session.userId })` |
| bulk import | `eventRepo.ts:650` | repoint the broken `ON CONFLICT (source_id,target_id,community_id)` at `link_identity`; add `pair_key`/`origin`/`updated_at` to the raw INSERT |

**Symmetric auto-undo (fixes confirmed edge leaks):** wire `removeAutoLink('event_attendance', attendeeId)` into `setAttendeeStatus` on decline/cancel (today it just rewrites `metadata.status`, leaking the edge), into host removal, and into intro disconnect. A **promoted** (now `manual`) edge is never deleted by system cleanup — `deleteMany` matches 0 rows.

**Dedup/merge when manual duplicates auto:** the manual upsert hits the existing auto row's `update` branch and **promotes it** (origin→`manual`, sets `createdBy`) — no second row. When an auto trigger later fires for a now-manual pair+relationship, the `update` branch (auto case) leaves `origin` untouched — the human assertion wins. Reversed-direction duplicates collapse via `pairKey`. Re-RSVP just refreshes `metadata.status`/`updatedAt`.

## 4. Manual creation UX (web)

### (a) Drag-to-connect on the graph

All changes in `apps/web/components/graph/CustomForceGraph.tsx`; the existing body-drag/pan/frozen-sim path is untouched.

**Disambiguation — chosen: hover-revealed connect handle (a dedicated start zone).** Rejected: Shift+drag (a chord against the "remove hassle" goal, undiscoverable); whole-node-drag (collides with move). The handle needs **no modifier on the common case**, the handle hit-test is a clean sibling of the existing `findNodeAt`, and it leaves the load-bearing move-drag code byte-for-byte unchanged. Industry consensus (FigJam/Miro/Obsidian hover-dots, n8n/React Flow handles, Cytoscape edgehandles) points here — so the handle shows **only on hover/focus, admin-only** (heeds Miro's "users disable always-on dots" lesson).

Exact integration (the four early-return seams):

1. **`handleMouseDown` (~655):** add `if (e.button !== 0) return;` at the top — fixes the confirmed pre-existing bug where a right-press arms a pan, *and* clears the way for `onContextMenu`. Then, before the existing `findNodeAt` body test, call new `findHandleAt(x,y)` (screen-space ~16px hit circle on the hovered/focused node's right edge). On hit: set `connectFromRef`, `connectModeRef=true`, `crosshair` cursor, and **return early** (never arm `isDraggingRef`, never pin, never pan).
2. **`render()` (~before `ctx.restore()`):** when a node is hovered/selected and viewer is admin, draw the handle (radius `× 1/transform.k` so it's screen-constant). When `connectModeRef`, stroke a **dashed rubber-band** from `connectFromRef` to the cursor, and a highlight ring on the snap candidate.
3. **`handleMouseMove` (~688):** branch **before** the `isDraggingRef` branch — track cursor + snap target, `scheduleRender()`, `return`. **No pin, no `markDirty`, no `simulation.restart`** — the frozen sim is never touched.
4. **`handleMouseUp` (~755):** branch at the **top**, before click-synthesis and drag-persist: if a valid target node under cursor (not self), `onCreateLink(from, target)`, reset refs, `return`.

**Target snapping:** `findNodeAt` within ~40px screen / `transform.k`, highlight ring. Reject self-loops. `Esc` cancels mid-drag.

**Drop behavior — quick type picker, default = last-used.** On a valid drop, `onCreateLink(from, target)` opens a small popover anchored at the target node listing the community's `linkTypes` (color swatch + name), with the **last-used type pre-selected** (persisted in a ref + `localStorage`); one click or `Enter` confirms, `Esc` cancels. On confirm, `DirectoryGraphView` optimistically splices `{source, target, relationship:<slug>, origin:'manual'}` into the links array (tinted with the type color), then POSTs `/api/data/links`. On 2xx → `clearGraphCache + refresh`; on failure → roll back + toast. A **6s "Undo" toast** follows for the rare wrong-link. (This honors "admin chooses the type" without a heavy form — the pre-selected default keeps the common case to a single extra click.)

### (b) Right-click context menu (graph + everywhere a node renders)

No context-menu primitive exists (no Radix/Floating-UI). Build **one** `<NodeContextMenu>` by copying the `ConnectButton.tsx` panel markup (already `role=menu`, brand-styled, click-outside), rendered `position: fixed` at the cursor (the canvas can't host DOM), viewport-clamped, `z-50`, `Escape` to close. Reuse `Dropdown.tsx`'s exported `DROPDOWN_MENU_CLASS`/`DROPDOWN_ITEM_CLASS`.

- **In-graph:** `onContextMenu` on `<canvas>` → `preventDefault`, `findNodeAt`, raise `onNodeContextMenu(node, {clientX,clientY})` to `GraphWithTable` (owns selection + sidebar) to host the menu DOM.
- **Outside the graph:** the **same** component on right-click of profile cards (extend `ConnectButton` with a "Connect to…" item), directory/CRM rows, search rows, plus a `⋯` kebab for discoverability/touch.

Items (admin-gated): **"Connect to…"**, "View profile", admin-only "Remove links".

**"Connect to…" typeahead — `<ConnectToPicker>`:** a small floating popover (`SearchInput` + `useNodeSearch` + result rows) — *not* the heavy `IntroRequestModal`. Type → pick target → relationship `Dropdown` populated from the community's `linkTypes` (default = last-used) + swap-direction → create via the **same** `onCreateLink`/POST path as drag. **Two required fixes to `/api/nodes/search`:** add `community_id` scoping and exclude source + existing neighbors (today it searches all communities with no exclusion — verified `nodes/search/route.ts:77`).

## 5. API

**No new path.** Extend the existing `/api/data/links` (POST/PUT/DELETE already cover create/update/delete).

- **POST** (`route.ts:69`): route through `upsertLink({ origin:'manual', createdBy: session.userId })`. `relationship` is always sent by the UI (the type picker), validated against the community's `linkTypes`; if omitted, fall back to `'related'` so the endpoint can't 400 on a geometry-only call. Echo `origin` + `id`. Request `{ link: { source, target, relationship, since?, metadata? }, community_id }` → `{ link: {…, origin} }` (casing unchanged: top-level `community_id` snake, nested `source`/`target`).
- **DELETE** (`route.ts:178`): add optional `?relationship=`. Today's `deleteMany` on `(sourceId,targetId,communityId)` nukes **every** relationship between a pair; the param removes exactly one. Route through `removeLink`. **Admins may delete any edge regardless of `origin`** (auto edges included — per the locked decision); no `409` guard.
- **GET + serializer** (`normalizeLink`, `graphUtils.ts:29`): emit `origin` and the int `id` (finally exposed read-only) so the renderer can style auto vs manual and undo can reconcile. Add `origin`/`id` to `NBLink` (`lib/types.ts`).
- **`/api/nodes/search`:** add `community_id` + `exclude_ids` (backward-compatible).
- Keep `revalidateTag('graph-data-v2')` on every write.

**Auth — keep `isAdmin`, structured for a one-line member flip.** Existing POST/PUT/DELETE are all `isAdmin`-gated (verified; super-admin folded in); the "content submission approval" TODO (line 64) was never built. Keep admin-only to match convention; loosening to "members may POST a link whose `source` is their own person node" is a single predicate before the 403. Gate UI affordances (handle render, menu items) on an `isAdmin` flag threaded into the graph so members never see an affordance that would 403.

## 6. Auto vs manual edges — visual + data

- **Data:** the `origin` column is the single source of truth; `createdBy` records the actor; `updatedAt` records last-touch.
- **Visual:** in `LinkRenderer.ts` `drawLinks` (the single `strokeStyle` block), render `origin !== 'manual'` (auto) edges **dashed + muted/thinner** (`setLineDash` scaled `× 1/transform.k`); manual edges **solid, stroked in their link-type color** (from the community's `linkTypes`), with an arrowhead when the type is `directed`. A promoted edge restyles solid — visually "confirming the machine's suggestion."
- **Deletable?** Admin-only server-side (members never mutate). **Admins can force-remove any edge, including auto ones** (locked decision). Accepted tradeoff: deleting an `attended`/`hosting`/`introduced` edge while the underlying RSVP/intro still exists means a later re-RSVP/re-accept will recreate it (the auto-flow's `upsertLink` fires again). If that proves annoying, a `metadata.suppressed` tombstone is a small later add — not built in v1.

## 7. Undo & accidental-edge prevention

- **Undo:** the 6s toast "Undo" is primary (optimistic remove + DELETE). Add a session undo stack in `DirectoryGraphView` (last N ops in a ref); `Cmd/Ctrl+Z` replays the inverse. Key undo on the `(source,target,relationship)` tuple (not array index) so it survives a `graph-data-v2` revalidation mid-toast.
- **Accidental-edge prevention:** (a) dedicated handle zone means body-drag never starts an edge; (b) require crossing `DRAG_THRESHOLD` (5px, already defined) before the rubber-band commits; (c) the handle shows only on hover/focus and only for admins; (d) `Esc` cancels; (e) drop on empty canvas = silent cancel in v1; (f) self-loops and exact duplicates are no-ops via `link_identity`.

## 8. Edge cases & risks

- **`ON CONFLICT` against a non-existent constraint** (`eventRepo.ts:653` + seed scripts) is a **confirmed latent runtime bug** — repointing it at `link_identity` ships regardless of the UI work.
- **Pre-index dedup is mandatory** — `db push` fails to create `link_identity` until reversed/exact duplicates are collapsed. The merge rule (lowest id, manual wins origin, union metadata) must be explicit.
- **`@updatedAt` + raw SQL:** `updateCommunityGraphData` writes via `$executeRaw` and must set `updated_at`/`origin`/`pair_key` explicitly or hit NOT-NULL.
- **Stale Prisma client after `generate`** is a known footgun on this box — regenerate after schema edits before testing.
- **Optimistic reconciliation** keyed on `(source,target,relationship)` can mis-target a rollback under concurrent same-pair edits — short window + refresh mitigates.
- **No edge hit-testing exists** — "delete this edge" targets a node's links via the menu in v1; a `findLinkAt` edge inspector is deferred.
- **Touch is unhandled** (mouse-only today) — long-press-to-reveal-handle is a deferred follow-up.
- **Visual verification:** Phases 2–4 edit `.tsx` — verify with Playwright MCP (`/dev/login` → `admin@local.dev` → directory graph tab).

## 9. Phased implementation plan

**Phase 0 — Data model + one write path (no UI).** Edit `schema.prisma`: `Link` gets `origin`, `originRef`, `createdBy`, `updatedAt`, `pairKey`, `@@unique link_identity`, `@@index pairKey`; `Community` gets `linkTypes Json?`. Add `LinkTypeConfig` + `DEFAULT_LINK_TYPES` + `getLinkTypes()` to `lib/types.ts`; add `linkTypes` to the `Community` interface and the GET/POST/PUT handlers in `app/api/data/communities/route.ts`. Add the dedup-collapse + column SQL to `scripts/apply-sql-functions.mjs`; run the §2 runbook then `pnpm db:migrate`. Build `lib/graph/links.ts` + `lib/graph/relationships.ts` (`normalize()` keyed off `linkTypes`/`DEFAULT_LINK_TYPES`). Route **all five** write sites through `upsertLink`; repoint the broken `ON CONFLICT`; fix the raw INSERT column list. `node:test` units for dedup/promotion/reversed-pair/auto-no-op. `tsc --noEmit`.

**Phase 1 — API: origin-aware + precise delete + symmetric undo.** POST stamps `origin='manual'`/`createdBy`, defaults `relationship='related'`. DELETE gains `?relationship=` + the `409` auto-edge guard. Wire `removeAutoLink` into decline/cancel RSVP, host removal, intro disconnect. Surface `origin`/`id` via `normalizeLink` + GET.

**Phase 2 — Console link-types + right-click menu + ConnectToPicker (smallest delightful slice that ships a real UX).** Add a "Link types" section to the console (sibling of `TypesTab.tsx`'s Types & Aliases — reuse its `ColorPicker`/`saveCommunity`) so admins manage `linkTypes`. Build `<NodeContextMenu>` + `<ConnectToPicker>` + the shared `<LinkTypePicker>` (reads `currentCommunity.linkTypes`, remembers last-used). Wire `onContextMenu` on the canvas (+ `e.button !== 0` guard) → `GraphWithTable`. Add `community_id`/`exclude_ids` to `/api/nodes/search`. Mount the same menu on profiles + directory rows. Optimistic POST + `clearGraphCache`/`refresh`. Playwright verify.

**Phase 3 — Drag-to-connect on the canvas.** Connect refs + `findHandleAt`; admin-only handle render; the four early-return seams; rubber-band + snap; drop → `<LinkTypePicker>` (last-used pre-selected) → create + 6s Undo toast; `Esc` cancel. Thread `isAdmin` down. Playwright verify (pixel-diff confirming non-dragged nodes don't move during a connect; node-move still works).

**Phase 4 — Visual distinction + polish.** `LinkRenderer` dashed-muted (auto) vs solid (manual); `LinksTable` origin badge; `findLinkAt` edge inspector; session undo stack + `Cmd/Z`. Stretch: drop-on-empty create-and-link, touch/long-press.

## 10. Mobile follow-up

Zero contract impact, no blocker. The native apps never touch the graph or links — they read `/api/data/nodes` as a flat directory only (verified: zero `apps/mobile` hits for graph/links/relationship/sourceId). Adding `origin`/`id` to link DTOs and extending `/api/data/links` is web-only. The only action is documentation honesty: note in `VisvineApi.kt` that `/api/data/links` exists and is intentionally not mirrored. (Note: there is no `docs/native-migration/api-contract.md` — the de-facto contract is the route handlers + `VisvineApi.kt`.)

## 11. Decisions (locked with the user)

1. **Who can link → admins only.** Matches the existing `isAdmin` gate on `/api/data/links`. Members see no link affordances. The gate is structured as a one-line predicate so a future "members link from their own node" is a trivial flip.
2. **Relationship type → admin chooses from community-configured link types.** No silent default label; link types live in the community console (`Community.linkTypes`, managed like node types — §2). The drop/picker pre-selects the last-used type to keep it one click.
3. **Auto-edge deletion → admins can force-remove any edge.** No `409` guard; the DELETE works regardless of `origin`. Accepted tradeoff: a re-RSVP/re-accept recreates an auto edge that was force-removed while its source action still exists (a `metadata.suppressed` tombstone is a deferred option if needed).
