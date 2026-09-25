# Mobile

The phone is a lite extension of a space, not the desktop app on a small
screen. Two native clients (`apps/mobile/ios`, `apps/mobile/android`), thin
over the web app's routes with `Authorization: Bearer <jwt>`, three tabs each —
Home, Messages and Activity:

| Tab | What it is | Reads | Writes |
|---|---|---|---|
| **Home** | The space switcher and the space's feed. iOS swaps Feed, Events and Context under chips; Android has two rows (People, Events) that open the Directory and Events screens | `GET /api/data/spaces`, `GET /api/feed?spaceId=&cursor=&limit=`, `GET /api/events?spaceId=`, `GET /api/notes/tree` (iOS) | — |
| **Messages** | iMessage-style. **Agents** — the space's agents, each a standing chat thread; **Contacts** — DMs with people | `GET /api/spaces/<id>/agents/chat`, `GET …/agents/<name>/chat?cursor=`, `GET /api/messages/conversations` (type `DM`), `GET /api/messages/users?query=` | `POST …/agents/<name>/chat/stream` (SSE) or `POST …/agents/<name>/chat`, `DELETE …/agents/<name>/chat`, `POST /api/messages/conversations {userId}` (the DM), `POST /api/messages/conversations/<id>/messages` |
| **Activity** | Everything about you: runs that acted for you, mentions and replies, requests you can answer, the events you are going to | `GET /api/activity?cursor=&limit=` | the row's own `actions` (approve / decline through the existing member and access-request routes) |

**Tools are web and desktop only.** A Tool is code a space runs over its data,
and the phones run none of it: the server refuses a Bearer session (the phones
are the only clients that send one) and a session minted by a phone's sign-in
door (`cl: 'mobile'`) at every door where a Tool runs — frame token, bridge,
changes stream, status — and the proxy refuses a Bearer header on
`/api/tools/*` before any route runs (`lib/tools/clientClass.ts`). The phones
are sent no installed Tools and no `tool:*` rail keys in `GET /api/data/spaces`,
and nothing in `apps/mobile` names a Tool door (`tests/tools-client-class.test.ts`
reads every source file). An agent chat held from a phone renders no Tool for
the person either. A phone's *browser* is the web app; the rail simply carries
no Tools below the phone breakpoint.

**The apps view and edit; they do not create.** A note, a person, a space, an
event, an agent — anything new is asked of an AI through the Visvine MCP
server (`/api/mcp`), which makes it with the same actions the web uses. What
the phone writes is conversation (messages, agent chat, DMs), answers to
requests, joining a space and the person's own profile.

Every response is camelCase; action inputs (`space_id`, …) are snake_case
because they are the actions' Zod schemas. The clients mirror each handler by
hand (`apps/mobile/README.md`).

## Agent chat

`docs/agents.md § Chat` is the model. In short: a thread per (person, space,
agent); each message one turn on the space's model with the brief as system
prompt, the memory note read-only, the last 20 messages replayed, and the
agent's tools running **as the person**. Not a run.

- `GET /api/spaces/<id>/agents/chat` → `{ agents: [{ name, title, description,
  ready, problem, answering, thread: { lastMessageAt, lastPreview, unread } | null }] }`.
  `ready` is false with a `problem` sentence when the space has no runnable
  model or the brief does not parse; the composer shows the sentence.
- `GET …/agents/<name>/chat?cursor=&limit=` → `{ messages: [{ id, role, text,
  status, reason, trace: [{ tool, detail, ok }], createdAt }], nextCursor }`,
  newest first (keyset `createdAt|id`, default 40, max 100). The first page
  marks the thread read.
- `POST …/agents/<name>/chat/stream` `{ text }` → `text/event-stream` of
  `data: {"type": …}` events: `user` (the stored question), `tool`
  `{tool, detail}`, `tool_result` `{tool, text}` (clipped), `assistant`
  `{text}`, then `done` `{message}` — or `error` `{reason, message}` for a
  refusal (`no_model`, `budget`, `busy`, `invalid_brief`, `rate`,
  `unknown_agent`). A `: keepalive` comment every 15 s; the stream closes
  itself a little past the turn's 90 s. A phone that disconnects mid-turn
  finds the finished message on its next read — the turn is never tied to
  the response.
- `POST …/agents/<name>/chat` `{ text }` is the same turn answered as JSON
  `{ userMessage, message }`; refusals are `{ error, reason }` with 404 / 409 /
  422 / 429.
- One turn per thread at a time: a second send while one is answering is
  `busy` (409).
- **Who can chat**: anyone who can read the brief — the same people the
  roster shows the agent to. A member's phone lists no agents in a space
  whose `agents/` folder they cannot read; a space that wants its members
  chatting grants view on `agents/` (or the one agent's folder) like any
  other folder.

## Activity

`GET /api/activity` → `{ upcoming, items, nextCursor }`. `upcoming` (first
page only) is the caller's next events, soonest first. `items` is newest
first over a 30-day window, keyset paged on `at|id`:

```
{ id: "<kind>:<row id>", kind: run | mention | reply | join_request | access_request | event,
  at, title, subtitle, space: {id, name} | null, actor: {id, name, image} | null,
  href, target: { type: agent | conversation | members | accessRequests | event, … },
  actions?: [{ label: Approve | Decline, method, href, body? }] }
```

The sources (`lib/activity/service.ts`): finished `agent_runs` where the
caller was `runAsUserId` or `startedBy`; `message_mentions` of the caller;
replies to the caller's messages; pending join requests and pending context
access requests in spaces the caller administers; event attendances by the
caller's email or member node. `actions` point at the routes that already
exist, so the tab writes nothing of its own. The fold is pure
(`lib/activity/shared/fold.ts`, `rows.ts`) and tested.

## Local

`pnpm dev` with `ENABLE_DEV_AUTH=true`; the phone's Dev login lists the seeded
users. Without a model key the chat answers `no_model` — the expected local
state until a key is added under Console → Models.
