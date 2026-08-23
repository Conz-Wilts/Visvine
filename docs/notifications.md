# Notifications

The one way Visvine's machinery tells a person something: a broken OAuth connection, an
agent that was deactivated or whose run failed, an agent's own `notify`/question, a Tool
review decision, an access request waiting on them. There is no notification *system* to
administer — no preferences page, no channels — just a table, one writer function, a bell
in the Navbar.

## Where things live

| Piece | Path |
| --- | --- |
| Table `notifications` | `apps/web/prisma/migrations/20260821120000_notifications/` (`Notification` model) |
| Writer + reads | `apps/web/lib/notifications/service.ts` — `notify`, `listNotifications`, `unreadCount`, `markRead` |
| Kinds + pure helpers | `apps/web/lib/notifications/types.ts` (React-free, Prisma-free) |
| Routes | `GET /api/notifications?unread=1&take=30&scope=global\|space&spaceId=`, `POST /api/notifications/read {ids?\|all?, scope?, spaceId?}`, `POST /api/notifications/[id]/reply {text}` (answers an `agent_question`) — session only |
| Invitations | `apps/web/lib/spaces/invitations.ts`; `GET/POST /api/communities/[spaceId]/invitations`, `DELETE …/invitations/[id]`, `GET /api/invitations`, `POST /api/invitations/[id] {action}` |
| Realtime | `{ type: 'notification.new', notification }` on the per-user `/api/messages/stream` |
| Bell | `apps/web/features/shared/components/layout/NotificationBell.tsx` (in the Navbar) |
| Who is an admin | `spaceAdminUserIds(spaceId)` in `apps/web/lib/auth.ts` (inverse of `isAdmin`) |

## Writing one

```ts
import { notify } from '@/lib/notifications/service'

void notify(userIds, {
  spaceId,                       // optional; cascades with the space
  kind: 'connection_broken',     // NotificationKind — see types.ts
  title: 'Notion connection for Sales needs reconnecting',
  body: 'The refresh token was rejected (invalid_grant).',   // ≤ 2 KB, plain text
  href: '/admin?section=connectors',                          // in-app path the bell opens
  dedupeKey: `connection_broken:${connectionId}`,             // optional, see below
})
```

`notify` never throws and resolves `{ created }`. Rows are inserted with a single
`INSERT … ON CONFLICT DO NOTHING`, then each recipient's open tabs get the line over SSE.
There is deliberately no email channel — the bell is the inbox. Every failure is logged,
none propagate: the thing that just
happened must not fail because telling someone about it did.

**A stale space.** `spaceId` is a real FK (cascades with the space). If the space vanished
between the event and the write, the whole multi-row INSERT fails on the FK; `notify` catches
that one case (`isForeignKeyFailure` — Prisma `P2003` / pg `23503`), logs
`notifications.insert.stale_space` and retries once with `spaceId = null`, so every recipient
still gets the line, just without the space label. Any other failure is logged and dropped.

**Dedupe.** A partial unique index on `(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL
AND read_at IS NULL` means a repeat of an *unread* key creates nothing; once the person has
read it, the same key can fire again. Use it for "still broken" / "failed again" events
(`agent_run_failed` per agent per day, `connection_broken` per connection).

**Recipients.** Callers decide: the author, `spaceAdminUserIds(spaceId)`, whoever can
resolve a request. Super-admins are not implied.

## Kinds and writers

| Kind | Writer | Recipients | Dedupe |
| --- | --- | --- | --- |
| `connection_broken` | `lib/connectors/connections.ts#markBroken` (a refresh failed for good) | the connection's user, or the space admins for a `mode: space` connection | `connection:<id>:broken` |
| `agent_deactivated` | `lib/agents/hooks.ts#deactivateAgent` — machine reasons only (`key_rejected`, `repeated_failure`, `author_gone`, `config`, `brief_changed`); a human's own `admin` / `renamed` / `deleted` tells nobody | brief author + `runs_as` user + space admins | `agent:<space>:<name>:deactivated` |
| `agent_run_failed` | `lib/agents/runner.ts` fail path (skipped when the same failure deactivated the agent) | author only | `agent:<space>:<name>:failed:<YYYY-MM-DD>` |
| `agent_notify` | the agent's `notify` tool (`to: author` / `admins`) | as addressed | — |
| `agent_question` | the agent's `ask_human` tool | as addressed | — |
| `tool_review` | `lib/tools/registry.ts#reviewVersion` | the version's author | — |
| `access_request` | `lib/notes/accessRequests.ts#createAccessRequest` | the note's managers | — |
| `space_invite` | `lib/spaces/invitations.ts#inviteMember` | the invited person | `space_invite:<invitationId>` |
| `space_invite_answered` | `lib/spaces/invitations.ts#respondToInvitation` | the admin who invited | — |

Adding a kind is adding a string to `NOTIFICATION_KINDS` and a writer. Every writer is
`void notify(...)` — a courtesy that can never change the outcome of the thing it reports.

**Replies.** An `agent_question` row is answered from the bell: `POST /api/notifications/[id]/reply
{text ≤ 2000}` (`replyToQuestion` in `service.ts`) checks the row belongs to the caller and is a
question, that it is still **unread** (a read row is an answered — or dismissed — question:
a replayed POST is `409`, so an agent gets one reply per question), and that the caller is still an
**active `SpaceMember`** of the row's space (`403` otherwise — a question outlives a membership,
its answer must not); then reads the agent name back from the row's `href` (`/directory/agent:<name>` — no extra
column), enqueues an `agent_events` row (`kind: reply`, `source: reply:<userId>`, payload
`{question, reply, by}`) for that agent, and marks the line read. The answer reaches the agent as
the payload of its next run — there is no pause/resume.

## The bell

Fetches on mount, on window focus and every 60 s; patches in `notification.new` from the SSE
stream; click → mark read + navigate to `href`; "Mark all read". Same `useClickOutside` +
popover styling as the account menu. Unread `agent_question` rows show a Reply → one-line
input + Send.

**Two tabs.** A line either belongs to a space (`spaceId` set) or to the person (`spaceId`
null), and the bell shows one half at a time: **this space** — the space you are standing in,
the default — and **Global**, everything that isn't any space of yours. With no current space
there is no split, only the global half. The tabs are `?scope=global|space&spaceId=` on
`GET /api/notifications`, which answers with `unread`, `unreadGlobal` and `unreadSpace` so the
badge and both tab counts come from one round-trip. `scope=space` with no `spaceId` matches
*nothing* (`scopeFilter` returns `null`) rather than falling back to unfiltered — an empty tab,
never someone else's lines. "Mark all read" carries the visible scope, so clearing one tab
leaves the other alone.

## Invitations

The one notification that IS the decision. An admin's "invite by email" writes a
`space_invitations` row (`lib/spaces/invitations.ts`) and sends the invitee a `space_invite`
line; nothing has been granted when it lands. **Accept** in the bell is what creates the
`SpaceMember`, the staged `UserAlias` rows and the directory node —
`POST /api/invitations/[id] {action: 'accept' | 'decline'}`, answerable once, only by the row's
own invitee. The line is filed **global** (`spaceId: null`) on purpose: stamped with the space,
it would sit behind a tab someone who isn't a member yet cannot open. Its invitation id rides in
the `href` (`/invitations/<id>` — `invitationHref` / `invitationIdOfHref`), the same trick
`agent_question` uses to name its agent; it is not a page, and clicking the line does not answer
it. The admin hears back with `space_invite_answered` either way, and can withdraw an unanswered
invite from Console → Invite (`DELETE /api/communities/[spaceId]/invitations/[id]`).
