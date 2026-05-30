# Visvine Mobile — API Contract (Phase A1)

> **Status:** Draft v1 · **Owner:** Shared Architecture · **Last updated:** 2026-05-30
>
> This is the **single source of truth** both native pods build their data layers against (plan task
> **A1**). It documents the entire client↔backend contract the Expo app relies on today, verified by
> reading `apps/mobile/src/services/api.ts` and the live handlers under `apps/web/app/api/**/route.ts`.
> The backend is **unchanged** by the migration — native apps re-point at these same routes.
>
> Where the current RN client's TypeScript type disagrees with what the server actually returns, it is
> recorded in the **[Drift register](#drift-register--client-assumption-vs-server-truth)**. Native
> models must match **server truth**, not the RN type. A CI **contract-conformance test** (see end)
> should assert these shapes against staging so the contract can't silently rot during the build.

## Conventions

- **Base URL:** `EXPO_PUBLIC_API_URL` (native: a `BASE_URL` build field). Dev `http://localhost:3000`;
  Android emulator reaches the host as `http://10.0.2.2:3000`.
- **Auth:** `Authorization: Bearer <jwt>` on every authenticated request. The JWT is the HS256 session
  token (30-day TTL) minted by the OAuth callback. No refresh endpoint — on `401` the app must
  re-authenticate. There is **no** server-side token revocation for Bearer clients (see `signout`).
- **Client envelope (RN):** `ApiService.request<T>` wraps every call as `{ data?: T, error?: string }`.
  On `!response.ok` it returns `{ error: body.error ?? 'Request failed' }`; on a thrown/network error
  `{ error: <message> }`. Native should mirror this with a `Result`/sealed type.
- **Server envelope:** there is **no** uniform server envelope. Most routes return a **named-key object**
  (`{ communities: [...] }`, `{ nodes: [...] }`, `{ events: [...] }`, `{ message: {...} }`) and the RN
  client unwraps the key. A few return the **bare object** (`profile`, `event detail` actually wraps —
  see drift). Errors are always `{ error: string }` (+ sometimes `details`) with a non-2xx status.
- **JSON casing is inconsistent across routes** — this is the #1 native serialization gotcha:
  - `nodes` → `snake_case` (`image_url`, `community_id`) **but** `createdAt` is camelCase in the same object.
  - `communities` / `profile` / `messages` → `camelCase` (`imageUrl`, `createdAt`, `unreadCount`).
  - Use explicit `@SerialName` (kotlinx) / `CodingKeys` (Swift) **per field**; do not assume a global strategy.

## Endpoints (the 12 `ApiService` methods → ~9 routes)

| # | Client method | HTTP | Path | Auth | Success | Notes |
|---|---|---|---|---|---|---|
| 1 | `getSession()` | GET | `/api/auth/session` | Bearer (optional) | `200 {session:{user}\|null}` | **Always 200**, even unauthenticated (`{session:null}`). Do **not** treat as 401. |
| 2 | `getCommunities()` | GET | `/api/data/communities` | Bearer (required) | `200 {communities:Community[]}` | `requireSession` → 401 if missing. `Cache-Control: no-store`. |
| 3 | `getCommunity(id)` | GET | `/api/data/communities?id={id}` | Bearer | `200` | ⚠️ Route ignores `?id` — returns the **full list shape** `{communities:[...]}`, not a single Community. See drift. |
| 4 | `getEvents(communityId)` | GET | `/api/events?communityId={id}` | none server-side | `200 {events:EventWithStats[]}` | `communityId` required (400 if absent). Each event has embedded `analytics` **and** an extra `_stats`. |
| 5 | `getEvent(eventId)` | GET | `/api/events/{eventId}?communityId={id}` | none | `200 {event,stats,attendeesCount}` | ⚠️ Requires `communityId` query (400 if absent — the RN client does **not** send it). Returns a **wrapper**, not a bare Event. See drift. |
| 6 | `getConversations(query?)` | GET | `/api/messages/conversations[?query=]` | Bearer (required) | `200 {conversations:Conversation[]}` | 401 via `unauthorizedResponse()`. Server-side search when `query` present. |
| 7 | `getMessages(id,cursor?)` | GET | `/api/messages/conversations/{id}/messages[?cursor=&limit=&query=]` | Bearer | `200 {conversation,messages,nextCursor,hasMore}` | Default `limit=30`. Also supports `query`. |
| 8 | `sendMessage(id,text)` | POST | `/api/messages/conversations/{id}/messages` | Bearer | `201 {message:Message}` | Body `{text}` (zod `sendMessageSchema`); 400 `{error,details}` on invalid. ⚠️ Wrapped in `message`. |
| 9 | `getDirectoryMembers(cid)` | GET | `/api/data/nodes?community_id={id}` | none server-side | `200 {nodes:NBNode[]}` | `community_id` (snake) required (400 if absent). Ordered by `name asc`. |
| 10 | `getProfile(personId)` | GET | `/api/profile/{personId}` | Bearer (required) | `200 Person` (bare) | 401 no session, 404 not found. Same route as #11. |
| 11 | `getFullProfile(personId)` | GET | `/api/profile/{personId}` | Bearer | `200 Person` (bare) | Identical route to #10; RN just types the response differently. |
| 12 | `updateProfile(personId,patch)` | PATCH | `/api/profile/{personId}` | Bearer + **owner** | `200 Person` | 403 if `person.userId !== session.userId`. Body = partial Person fields (below). |
| — | (auth) `signout` | POST | `/api/auth/signout` | — | `200 {success:true}` | Deletes the web **cookie** only; **no-op for Bearer** — native logout = discard local token. |
| — | (realtime) message stream | GET | `/api/messages/stream` | Bearer | `200 text/event-stream` | SSE; see [Realtime](#realtime-sse). Not yet consumed by the RN app. |
| — | (dev) login | GET/POST | `/api/dev/list-users`, `/api/dev/issue-token` | `ENABLE_DEV_AUTH` | — | Test sign-in without Google; needed for native UI tests (plan T2). |

## Model shapes (server truth)

```jsonc
// Community (from /api/data/communities — richer than the RN `Community` type)
{ "id": "string", "name": "string", "description": "string", "country": "string?",
  "location": "string?", "tags": ["string"], "memberCount": 0, "dataFile": "string",
  "createdAt": "ISO-8601 string", "imageUrl": "string|null", "communityAliases": [...],
  "designConfig": {...}, "nodeTypes": null }
// RN maps imageUrl ?? image → image, then resolveMediaUrl()s it.

// NBNode (from /api/data/nodes — note mixed casing)
{ "id": "string", "type": "string", "name": "string", "alias": "string|null",
  "subtitle": "string|null", "location": "string|null", "url": "string|null",
  "image_url": "string|null", "tags": ["string"], "metadata": {}, "community_id": "string|null",
  "createdAt": "ISO-8601 string" }   // ← createdAt is camelCase though siblings are snake_case

// Person (from /api/profile/{personId} — the full Prisma record; RN reads it as FullProfile)
{ "id": "string", "communityId": "string|null", "name": "string", "subtitle": "string|null",
  "bio": "string|null", "location": "string|null", "website": "string|null",
  "linkedinUrl": "string|null", "twitterUrl": "string|null", "phone": "string|null",
  "pronouns": "string|null", "openToWork": false, "email": "string|null",
  "imageUrl": "string|null", "tags": ["string"], "metadata": {}, "userId": "string|null",
  "createdAt": "ISO string", "updatedAt": "ISO string" }
// PATCH body = any subset of: name, subtitle, bio, location, website, linkedinUrl,
//   twitterUrl, phone, pronouns, openToWork, tags, imageUrl, metadata.

// Conversation / Message / EventWithStats: shapes match apps/mobile/src/types/index.ts
//   (Conversation, Message, Event) plus events list adds:
//   "_stats": { "totalAttendees": 0, "registered": 0, "waitlisted": 0, "checkedIn": 0 }
// event detail wrapper: { "event": Event, "stats": {...7 status counts...}, "attendeesCount": 0 }
```

## `resolveMediaUrl` (port faithfully — unit-tested)

From `apps/mobile/src/services/api.ts`. Native must reproduce exactly; media is served **public**
(`/api/media/[...path]`, `Cache-Control: public`), so image loaders need **no** auth header.

```
resolveMediaUrl(url):
  if url is null/empty            → null
  if url matches ^(https?:|data:) → url            (absolute / data URI: pass through)
  if url starts with "/"          → BASE_URL + url  (root-relative: prefix)
  else                            → url             (bare token: leave as-is)
```
Applied via `resolveMember` (`image_url`), `resolveCommunity` (`imageUrl ?? image` → `image`),
`resolveUser`/`getFullProfile` (`imageUrl`).

## Auth / OAuth deep-link flow

1. App opens system browser (ASWebAuthenticationSession / Custom Tabs) to Google's auth URL with
   `redirect_uri = {BASE_URL}/api/auth/callback/google-mobile`, `response_type=code`,
   `scope=openid email profile`, and `state = urlencoded JSON { state, redirectUri, callbackUrl }`
   where `redirectUri = visvine://auth/callback`.
2. Google → server callback. The **server** does the code→token exchange (holds `GOOGLE_CLIENT_SECRET`),
   creates/links the user + Person, mints the session JWT.
3. **Success:** server 302 → `visvine://auth/callback?token={jwt}&hasOnboarded={true|false}&callbackUrl={/path}`.
   App stores `token` securely (Keychain/Keystore), sets it as the Bearer, calls `getSession()`.
4. **Error:** server 302 → `visvine://auth/error?error={code}[&message=...]`. Codes seen:
   `no_code`, `token_exchange`, `userinfo`, `no_email`, `account_claim_required` (the last is
   **web-only** — native must route the user to web to claim, per plan A2).
5. **Logout:** discard the stored token locally (the POST `/api/auth/signout` only clears the web cookie).

## Realtime (SSE)

`GET /api/messages/stream`, `Authorization: Bearer`, `Content-Type: text/event-stream`,
`runtime=nodejs`, `dynamic=force-dynamic`. Wire format:
- `: connected\n\n` preamble, then `: keepalive\n\n` every **20 s**.
- events: `data: {json}\n\n` where json is a `RealtimeEvent`:
  `{type:"message.new", conversationId, message}` or `{type:"conversation.updated", conversationId}`.

Native caveats (also in the strategy doc): header-auth means iOS hand-rolls over `URLSession.bytes`
(browser `EventSource` can't set headers); handle **401-on-expiry + reconnect**; **foreground-only**
(backgrounded delivery needs push). Server fan-out (`lib/messages/realtime.ts`) is **in-memory /
per-process** — only correct on a single Node instance until an external pub/sub is added.

## Drift register — client assumption vs. server truth

These are real mismatches found while writing this contract. Native should follow **server truth**;
each is a candidate fix in the RN client too, and each should be a contract-conformance assertion.

| Method | RN client types it as | Server actually returns | Native must |
|---|---|---|---|
| `getEvent` | `Event` | `{ event, stats, attendeesCount }` **and** needs a `communityId` query the client never sends | read `.event`; **send `communityId`** (else 400) |
| `sendMessage` | `Message` | `{ message: Message }` (201) | read `.message` |
| `getCommunity(id)` | single `Community` | the **full list** `{communities:[...]}` (route ignores `?id`) | filter client-side, or treat as list |
| `getProfile` | `DirectoryMember` | full `Person` record | model as `Person`; `DirectoryMember` is a view subset |
| `getSession` | (handled) | `{session:null}` at **HTTP 200** when unauthenticated | treat `session==null` as logged-out, not an HTTP error |
| node JSON | uniform casing | mixed (`image_url` + `createdAt`) | per-field `@SerialName`/`CodingKeys` |

## Contract-conformance test (CI)

Add a test (plan A1/E1) that, against **staging**, asserts each row above: status code, the named-key
wrapper, and presence/casing of the documented fields. Generate fixtures from this doc so a backend
change that breaks the contract fails CI during the multi-month native build rather than at runtime.
