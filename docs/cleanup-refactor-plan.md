# Cleanup & Refactor Plan — apps/web

> Generated 2026-06-28 from a 6-area deep review (dead code, API routes, lib, components, features/hooks, pages/config/schema). Every high-impact claim below was independently re-verified by grep before inclusion. Organized by **risk tier** so the safe, behavior-preserving work can ship first and the contract/DB-sensitive work stays gated behind explicit decisions.

**Guiding constraint:** behavior must not change. Anything that could alter the mobile API JSON contract is marked **[CONTRACT]**; anything that touches the production database is marked **[DB-MIGRATION]**; anything requiring a product call is marked **[DECISION]**.

**Verification after every batch** (Windows note: `next build` EPERM-fails here for environmental reasons — rely on the first three):
```
pnpm --filter @visvine/web exec tsc --noEmit
pnpm --filter @visvine/web lint
pnpm --filter @visvine/web test
```

---

## Status

**Tier 0 executed and verified — 2026-06-28** (tsc ✓ / lint ✓ / 109 tests ✓; lockfile synced). Done in the working tree (not committed):
- 25 dead files deleted (0a–0d), 4 dead deps removed (0f), config cruft fixed (0g), 7 dead exports trimmed (0e).
- **Deferred within Tier 0:** `eventRepo.updateCommunityGraphData` + `graphUtils.filterGraphByNodeIds` (deliberate multi-line edits), the `webpush`/`sw.js` push stack and the obsolete-scripts triage (0h) — all gated on a decision or warranting care.

**Tier 1 — auth unification + first dedup done & verified — 2026-06-28** (tsc ✓ / lint ✓ / 109 tests ✓):
- **[1a] Latent auth bug FIXED** — `crm/column-requests` + `crm/value-share-requests` now use the canonical `isAdmin` (case-insensitive super-admin compare); deleted their buggy local copies.
- **[1a] Admin-gate consolidation** — added `getAdminSession(communityId)` to `lib/auth.ts`; the 7 hand-rolled `requireAdmin` copies now import it (aliased, so call sites + exact 403 responses unchanged). Trimmed orphaned `prisma` imports in the 3 stub routes.
- **[1a]** Simplified `getApiMessagingUser` (removed redundant Bearer block) and `auth/session` route (removed redundant Bearer branch) — both delegate to `getSession()`.
- **[1b]** Deleted the dead `/api/link-preview` route (zero callers; closes the SSRF surface). Kept `lib/linkPreview.ts` (referenced by disabled messaging).
- **[1c]** Extracted `attendeeToWritable()` in `eventRepo.ts` (the 13-field mapping the code itself flagged as duplicated).

**Tier 1 — safe 1c helpers done & verified — 2026-06-28** (tsc ✓ / lint ✓ / 109 tests ✓):
- **Bonus dead-code:** deleted orphaned `hooks/useEventDetails.ts` (its only consumer `EventSidebarContent` was removed in Tier 0). This made `createCachedResource` moot — `useNodeProfile` is now the sole cache hook, so there's nothing left to dedup. Skipped.
- **`ModalFooter`** — created `components/profile/edit/ModalFooter.tsx`; adopted in all 4 profile edit modals (identical Cancel/Save footer).
- **CSV tokenizer** — created `lib/crm/csv.ts` (`splitCsvLine` + `parseCsvRows`); wired both `lib/crm/importService.parseCSV` and `features/crm/utils/parseCSVClient` to it. CSV unit tests confirm identical behavior.
- **`useClickOutside` + `useEscapeKey`** — created `hooks/useClickOutside.ts` + `hooks/useEscapeKey.ts` (attach-once handler-ref design preserves the originals' semantics; `useEscapeKey` takes an `enabled` guard). Adopted `useClickOutside` in 4 clean dropdowns (`ui/Dropdown`, `auth/UserMenu`, `dashboard/FilterDropdown`, `crm/RowActionsMenu`) and `useEscapeKey` in `profile/edit/EditModal`.
- **Skipped on purpose:** `slugify` (behavior differs across blog/event/notes — out of "safe" scope); the ~57-file `requireSession` sweep (cosmetic + contract-subtle); 1d error envelopes (CONTRACT). `findOrCreateCommunityColumn` not done.
- **Remaining click-outside/Escape sites available for incremental adoption** (left because they combine mousedown+Escape in one effect, use a `setTimeout` open-delay, or have `if(!open)return` guards / multiple refs): `CommunitySettingsPanel`, `CreateModalForms`, `BlogCommentItem`, `MarketingShell`, `CustomDateTimePicker`, `LocationAutocomplete`, `CommunitySelector`, `CTARow`, `MembersPanel`, `NoteEditor`, `graph/ConnectMenu`, `resources/page` drawer, `auth/SignInModal`. The hooks now exist; adopt as each file is touched.

---

**Tier 0 deferred + Tier 2 structural removals done & verified — 2026-06-28** (tsc ✓ / lint ✓ / 109 tests ✓; lockfile synced):
- **T0 deferred:** removed dead `eventRepo.updateCommunityGraphData` (70 lines) + `graphUtils.filterGraphByNodeIds` (+ orphaned `Prisma`/`GraphData` imports).
- **T1 extra:** fixed the `useResources` stale-response race (request-token guard). **Skipped `CommunityAvatar`→avatarUtils** — its `getInitials`/`getAvatarColor` produce *different* output (different initials + palette), so it is NOT behavior-preserving.
- **T2 structural:** deleted the orphaned `/[communityId]/directory` route + the whole `features/crm` grid tree (17 files; kept `utils/parseCSV` + `utils/buildColumns` for tests). Deleted 3 disabled-only routes (`profile/by-user`, `push/subscribe`, `users/[userId]/block`), `lib/webpush.ts`, `public/sw.js`. Removed 6 now-unused deps (`@chenglou/pretext`, `emoji-picker-react`, `react-markdown`, `rehype-sanitize`, `remark-gfm`, `web-push`) + `@types/web-push`. `lib/messages/auth.ts` + `lib/linkPreview.ts` kept (now live-orphaned but referenced by the `/disabled` revival tree).

### Deliberately SKIPPED (would change contract / visuals / validation, or pure churn — documented so they're a choice, not an oversight)
- **~57-file `requireSession` sweep** — pure cosmetic rename, zero functional value, would balloon the diff; some routes use different 401 bodies (contract). `requireSession` is available for new code.
- **1d error-envelope standardization** — CONTRACT-sensitive (mobile parses these).
- **`findOrCreateCommunityColumn`** — the two CRM-request PUTs genuinely diverge (options/seeding vs value upsert); extraction risks the untested approval flow.
- **`linkRowToNBLink` + PUT reconciliation** — CONTRACT (changes `data/links` wire shape).
- **Adopt `ui/Button` across ~34 sites** — visual change (inline buttons have varied styling); not behavior-preserving.
- **Zod on the remaining mutating routes** — changes which inputs are accepted/rejected.
- **Stub routes** (`submissions`, `submissions/count`, `activity`) — left as working empty-state endpoints; removing them deletes live (if empty) admin panels = product decision.
- **Obsolete-scripts triage** — harmless, judgment-heavy; left for the user.
- **~13 more click-outside/Escape sites** — untested UI with guards/timers; adopt incrementally.

**Tier 3 — schema bloat REMOVED & verified — 2026-06-28** (user-authorized; prisma generate ✓ / tsc ✓ / lint ✓ / 109 tests ✓):
- Removed **27 models + 2 enums** from `schema.prisma` (1099 → 653 lines): the messaging family (Conversation/ConversationMember/Message/MessageImage/MessageMention/MessageReaction/LinkPreview/MessageLinkPreview/MessageDelivery/MessageAttachment/MessageStar/Poll/PollVote/ScheduledMessage/PushSubscription/UserBlock + `ConversationType`/`ConversationMemberRole` enums), the feed family (Post/PostImage/PostComment/PostLike/PostMention/PostReaction/PostCommentReaction), `IntroRequest`, and `EventMessage`.
- Removed the back-relation fields on the kept models: **User** (16 fields), **Community** (`introRequests`, `channels`).
- Fixed live code refs: `overview` route (dropped the `post.findFirst`; kept `lastPostAt: null` so the **response shape is unchanged**), `seed.ts` (removed the messaging `deleteMany` cleanup), and deleted the now-fully-orphaned `lib/linkPreview.ts`.
- Kept `extensions = [vector]` (see DO NOT TOUCH).

> ⚠️ **DEPLOY IS DESTRUCTIVE.** This is a working-tree change (reversible in git). When `prisma db push` runs against a database it will **DROP** those ~30 tables. Back up production and confirm the features are permanently retired **before deploying**. Locally, `pnpm db:push`/`db:fresh` will drop them from the disposable Docker DB (re-seed after).

## DO NOT TOUCH (verified intentional / high-risk)

- `lib/graph-layout/graphLayout.ts` (2283 LOC) — intrinsic force-directed-layout algorithm; complexity is essential, not accidental.
- `hooks/useCachedCommunityResource.ts` — the module-level signature map + eslint-disabled deps are deliberate (commented); a naive "simplification" reintroduces a cache bug.
- `lib/mcp/tools/{analytics,blog,crm,directory,identity,profile,resources}.ts` — parked on purpose (`lib/mcp/tools/index.ts` documents the drip-feed plan). knip flags them as unused; they are not.
- Deps `eslint*`, `@tailwindcss/postcss`, `tailwindcss`, `@types/google.maps` — depcheck false positives (config/namespace usage).
- `prisma/schema.prisma` `extensions = [vector]` — removing it makes `prisma db push` attempt `DROP EXTENSION vector` against prod. Leave declared even though unused.
- Mixed snake_case/camelCase JSON and named-key envelopes — the native apps mirror these; do not "fix" casing.

---

## Tier 0 — Pure dead-code deletion (zero behavioral risk)

Nothing here is referenced by live code (verified). Delete in one sweep, then run the verification triple.

### 0a. Stray / scratch files
- [ ] `apps/web/tmp-repro-crossings.ts` — tracked scratch repro for edge-crossing tests; zero references.
- [ ] `apps/web/prisma/seed-feed.ts` — seeds the disabled feed; no package.json runner, not imported.

### 0b. Dead component island in `components/data/` (8 files)
Rooted at the two unimported tables; the whole subtree is dead. **Keep `data/TypesTab.tsx`** (live via admin page — it imports none of these).
- [ ] `NodesTable.tsx`, `LinksTable.tsx` (the dead roots; `GraphDataTables.tsx` uses its own *local* tables)
- [ ] `EditableDataTable.tsx`, `ComboboxMultiSelect.tsx`, `FilterPopover.tsx`, `TableToolbar.tsx`, `ExpandedRowCard.tsx`, `TypeSelectDropdown.tsx` (only importers are the dead roots / each other)

### 0c. Other dead components (~1,700 LOC)
- [ ] `components/events/EventForm.tsx` (635) — superseded by `EventComposer`
- [ ] `components/events/EventActions.tsx` (79) — zero refs
- [ ] `components/events/AttendeesTable.tsx` (177) — superseded by `GuestManager`
- [ ] `components/graph/NodeDetailsSidebar.tsx` (552) + `components/graph/EventSidebarContent.tsx` (202) — dead pair (sidebar already unimported at HEAD; the `M` in git status is incidental). Also remove the stale comment at `lib/contexts/ProfileContext.tsx:12`.
- [ ] `components/graph/renderers/HexagonNodeRenderer.ts`, `components/graph/utils/hitTest.ts` — zero refs
- [ ] `components/ui/SearchInput.tsx`, `components/ui/PageHeader.tsx` + their barrel lines in `components/ui/index.ts` (also drop the unused `Avatar`/`Button` re-exports from the barrel if still unconsumed)

### 0d. Dead feature/lib modules
- [ ] `features/search/utils/` (`searchUtils.ts` + `index.ts`) — zero importers (the best fuzzy matcher in the repo, wired to nothing)
- [ ] `features/communities/hooks/` (`useCommunity.tsx` + `index.ts`) — **diverged** dead duplicate of `lib/contexts/CommunityContext` (no `isAdmin`, stale localStorage key — an active edit-the-wrong-file trap). Trim `features/communities/index.ts` to re-export `./components` only.
- [ ] `features/crm/hooks/useCrmSettings.ts` — zero importers
- [ ] `lib/schemas/introSchemas.ts` — intros disabled; referenced only from `/disabled`

### 0e. Dead exports (trim symbols, keep the live files)
> **Verification corrected several agent claims** — some "unused exports" are used *internally* (grep showed the callers). Those are kept; removing them would have broken the build.
- [x] `lib/messages/auth.ts`: `getServerMessagingUser`, `forbiddenResponse` — removed
- [x] `lib/personDedupe.ts`: `createPersonNode`, `ensureUniquePersonId` — removed (+ trimmed now-unused `slugify` import; kept `findMatchingPerson`)
- [x] `lib/graph/relationships.ts`: `linkTypeColor` — removed
- [x] `lib/types.ts`: `DirectoryItem.explanation` + `DirectoryItem.similarity` — removed (vestigial pgvector/LLM-search fields)
- [x] `lib/features.tsx`: `AppsGridIcon` — removed (the "More" launcher that used it is disabled)
- [ ] **Deferred (genuinely dead, but needs a deliberate multi-line edit):** `lib/eventRepo.ts:620` `updateCommunityGraphData` (70-line block, would orphan `GraphData`/`revalidateTag` imports — check those), and `lib/graphUtils.ts:43` `filterGraphByNodeIds` (trailing-whitespace-sensitive block).
- [x] **KEPT — NOT dead (agents were wrong):** `lib/gcs.ts:normalizeImageUrl` (used in 8 files), `lib/eventRepo.ts` `getCommunityLinks`/`updateEventAnalytics`/`upsertAttendee` (called internally at :244/:551,:583/:578), `lib/messages/rateLimit.ts:MESSAGE_SEND_LIMIT` (default param of `takeToken`).
- [ ] **Deferred to the push/messaging decision:** `lib/webpush.ts` `isPushConfigured`/`sendPushToUser` + `public/sw.js` (the whole push stack is decision-gated).
- [ ] Remaining knip-flagged unused types are low-value; sweep opportunistically (`lib/schemas/eventSchemas.ts` Zod schemas, `lib/types.ts` `DiagnosticReport`/`CommunitiesRegistry`/`ResourceFileType`). `noteCount`/`listFolders` were already gone.

### 0f. Dead dependencies (package.json)
- [ ] `@tiptap/extension-link` (dep) — zero refs incl. `/disabled`
- [ ] `@faker-js/faker`, `seedrandom`, `@types/seedrandom` (devDeps) — seed no longer uses faker; zero refs

### 0g. Config cruft & doc drift
- [ ] `tailwind.config.js` — remove dead content globs `./pages/**/*` and `../../packages/ui/src/**/*` (neither path exists)
- [ ] `tsconfig.json` — drop redundant `"@/features/*"` alias (subsumed by `"@/*"`)
- [ ] `lib/features.tsx` — remove dead `core` field + the `if (feature?.core)` branch; fix the stale doc comment referencing channels/Messages
- [ ] `next.config.ts` — reconcile `GCS_CDN_HOSTNAME` (read but never set in deploy.yml) vs `GCS_CDN_BASE_URL` (the live one); fix the misleading comment **[verify next/image intent before changing behavior]**
- [ ] CLAUDE.md — `lib/ai/*` doesn't exist; the only AI code is `lib/notes/ai.ts`
- [ ] `public/sw.js` — unwired push service worker (no `serviceWorker.register`); remove with the `webpush` exports, or wire it up **[DECISION]**

### 0h. Obsolete scripts (triage, then delete the confirmed-done)
- [ ] Likely-complete one-offs: `scripts/migrate-to-gcs.ts`, `scripts/update-blackbird-aliases-prod.mjs`, `apps/web/scripts/_ingest-research.mjs`, `apps/web/scripts/build-icehouse-data.mjs`. Keep wired/idempotent ones (`add-test-communities.mjs`, `refresh-events.mjs`, `prod-schema-presync.mjs`, `seed-blackbird-prod.mjs`).

---

## Tier 1 — Behavior-preserving consolidation (low risk, mechanical)

### 1a. Auth-gate unification (biggest correctness + line win)
The repo has **five** good auth helpers but most routes hand-roll the checks. `requireSession()` (returns `payload | Response`) is the model.
- [ ] **Latent auth bug:** `crm/column-requests/route.ts` + `crm/value-share-requests/route.ts` reimplement `isAdmin` with a **case-sensitive** super-admin email compare (canonical `isSuperAdmin` lowercases both) and a redundant inner `getSession()`. Replace both with `lib/auth.ts:isAdmin`.
- [ ] Collapse the ~11 copy-pasted community-admin gates (local `requireAdmin` ×7 + inline ×4) onto a single shared `requireAdmin(communityId): Promise<SessionPayload | Response>` (place beside `requireCommunityMember` in `lib/eventAuth.ts`).
- [ ] Migrate the ~57 files using `getSession()` + manual 401 to `requireSession()` (same 401 body — not [CONTRACT]-affecting).
- [ ] Delete the redundant Bearer branch in `app/api/auth/session/route.ts` (`getSession()` already checks Bearer first).
- [ ] Simplify `lib/messages/auth.ts:getApiMessagingUser` to delegate to `getSession()` (the manual Bearer block duplicates `getSession`). Then `messages/auth.ts` becomes a thin shim; move `link-preview`/`block`/`push` routes onto `requireSession` directly.

### 1b. link-preview route — delete (preferred) or wire
The HTTP route `app/api/link-preview/route.ts` has **no live caller** (checked app + mobile + disabled) and reimplements `lib/linkPreview.ts` **without** its SSRF guard or byte cap.
- [ ] **[DECISION/CONTRACT]** Confirm no mobile client hits `/api/link-preview`, then **delete the route + `lib/linkPreview.ts`** (kills the SSRF surface and the duplication). If it must stay, instead point it at `lib/linkPreview.fetchLinkPreview` to inherit the guard. (Keep the `LinkPreview` Prisma model — still referenced by disabled messaging.)

### 1c. Extract shared helpers (pure dedup)
- [ ] `attendeeToWritable(a)` in `lib/eventRepo.ts` — the 13-field mapping is duplicated verbatim at `:382-396` and `:522-536` (code already comments the duplication).
- [ ] `findOrCreateCommunityColumn(req)` in `lib/crm/` — ~110 near-identical lines across the two CRM-request PUTs.
- [ ] `createCachedResource<T>(fetcher, ttl)` — collapses the identical cache+inflight-dedup machinery in `hooks/useNodeProfile.ts` and `hooks/useEventDetails.ts` (~60 lines); later fold `hooks/useProfile.ts`'s prefetch map onto it.
- [ ] `useClickOutside(ref, handler)` — replaces the same `mousedown`/`contains` block copy-pasted in ~12 files.
- [ ] `useEscapeKey(onClose)` — replaces the same Escape handler in ~13 files.
- [ ] `<ModalFooter onCancel saving />` — identical Cancel/Save footer in the 4 profile edit modals.
- [ ] One `slugify(input, opts)` — reconcile the diverging copies in `lib/blog/slug.ts`, `lib/eventUtils.ts`, and `features/notes/.../NotesWorkspace.tsx`.
- [ ] Move CSV `splitLine`/`parseCSV` core into `lib/crm/`; have both the client preview (`features/crm/utils/parseCSV.ts`) and server import (`lib/crm/importService.ts`) call it.
- [ ] `useFetch(url, {enabled})` — unify the 5 divergent one-off fetch idioms; migrating `hooks/useResources.ts` onto it also fixes its real (minor) stale-response race on fast community switches.
- [ ] Point `components/community/CommunityAvatar.tsx` at `lib/avatarUtils` (it re-implements `getInitials`/`getAvatarColor` inline with a different palette).
- [ ] Remove the duplicate fuzzy scorer: keep `useDashboardSearch` (intentionally name-only) and one weighted scorer; drop the now-deleted `searchUtils` copy and the degraded char-diff in `lib/graphUtils.ts` (or upgrade it to real Levenshtein).

### 1d. Error-handling consistency (internal only)
- [ ] Unify the 401 construction so `requireSession` and `messages/auth.unauthorizedResponse` emit one shape (`NextResponse.json`). Keep mobile-facing wire strings stable — only touch internal-only routes here.

---

## Tier 2 — Larger refactors / require a decision (medium risk)

- [ ] **[DECISION]** Orphaned `/[communityId]/directory` route + the `features/crm` UI tree (CrmGrid + ~16 files). The live directory is `/directory` (`components/crm/CrmDirectoryTable`). No inbound links found to the old route. If the URL isn't externally bookmarked, delete the route + tree (~2–3k LOC). Keep/move `features/crm/utils/{parseCSV,buildColumns}` — they back `tests/crm-*.test.ts`.
- [ ] **[DECISION]** Stub routes returning hardcoded empties with live UI panels: `communities/[id]/submissions` (`{submissions:[]}`), `submissions/count` (`{count:0}`), `activity` (`{logs:[]}`). Implement or remove the route+panel pairs.
- [ ] **[DECISION]** Dead routes referenced only from `/disabled`: `profile/by-user/[userId]`, `push/subscribe`; truly-dead `profile/public`, `auth/profile`, `users/[userId]/block`. Tie removal to the "revive messaging?" call.
- [ ] **[DECISION]** Deps used only by `/disabled` messaging: `@chenglou/pretext`, `emoji-picker-react`, `react-markdown`, `rehype-sanitize`, `remark-gfm`. Remove only if messaging is being abandoned.
- [ ] **[CONTRACT]** Extract `linkRowToNBLink()` for `data/links/route.ts` and reconcile the PUT response (it currently omits `id`/`origin` that GET/POST include) — align deliberately, don't silently change the wire shape.
- [ ] **[CONTRACT]** Standardize a `respondError(status, code, details?)` helper across routes, keeping the exact strings the native apps parse.
- [ ] Adopt `ui/Button` across the ~34 hand-rolled pill buttons and generalize `profile/edit/EditModal` into a shared `ui/Modal` (Escape + backdrop-close + scroll) for the ~10 bespoke modals. Stage incrementally; don't sweep in one PR.
- [ ] Add Zod validation to the high-traffic mutating routes that hand-roll checks (`data/nodes`, `data/links`, `crm/*-requests`, `crm/*-values` PUT, `communities/settings` PUT) — mirror current checks so behavior is preserved.

---

## Tier 3 — Database schema (REQUIRES-MIGRATION, gated by product decision)

Per the `disabled-features` note these tables were **intentionally kept**. Touch only after deciding messaging/feed/intros are not returning. `prisma db push` is destructive against prod — stage on local first, back up prod.
- [ ] **[DB-MIGRATION]** Fully orphaned, zero code refs — lowest risk: `IntroRequest` (+ `Community.introRequests`), `EventMessage`.
- [ ] **[DB-MIGRATION]** Feed/Post family (8 models) — after replacing the single live `post.findFirst` `lastPostAt` read in `communities/[id]/overview/route.ts`.
- [ ] **[DB-MIGRATION]** Messaging family (Conversation/Message/Poll/Scheduled/etc.) — largest reduction; **keep** `PushSubscription`, `UserBlock`, `LinkPreview`/`MessageLinkPreview` (still have live endpoints).
- [ ] Leave `extensions = [vector]` alone (see DO NOT TOUCH).

---

## Suggested execution order

1. **Tier 0** in one branch → run verification triple → commit. Pure deletions, immediate ~4–5k LOC reduction, zero behavior change.
2. **Tier 1a + 1b** (auth unification + link-preview) → fixes the latent case-sensitivity auth bug and the SSRF surface. Verify.
3. **Tier 1c + 1d** (shared helpers) in small batches, one helper per commit, verify each.
4. **Tier 2** items individually, each behind its **[DECISION]/[CONTRACT]** gate.
5. **Tier 3** only after an explicit "these features are gone" decision, on local first, with a prod backup.
