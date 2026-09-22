# iMessage — plan

Status: **proposal**, not built. Researched against Sendblue's docs on
2026-09-22 (docs.sendblue.com). Items marked *unverified* must be checked
before the code that depends on them is written.

## What it is

A space can have its own iMessage number. Members text it — plain text or a
voice memo — and the space's `phone` agent does the work as them: search and
add context, run connectors, create events, anything the action registry does.
The number carries the space's name and icon.

It is a **platform feature, not a connector**. Visvine owns one Sendblue
account; each space gets a line on it. No space ever holds a Sendblue key,
edits a perimeter, or sees another space's line.
```
member's iPhone ──text/voice──▶ space's line (Sendblue)
      ▲                              │  webhook (one, account-wide)
      │                              ▼
      │                 POST /api/imessage/inbound
      │                   verify secret · dedupe message_handle
      │                   sendblue_number → line → space
      │                   from_number     → link  → user
      │                   member of space? voice → transcript
      │                   house or room? (rooms the texter is in)
      │                              ▼
      │                 summonAgent(space, 'phone', principal, text)
      │                   mailbox channel 'imessage' → manual run as the texter
      │                              ▼
      └──────reply◀── run ends → send-message from_number = line
```

## How the pieces fit what already exists

| Need | Existing seam | What changes |
|---|---|---|
| The brain | An agent note, `agents/phone/index.md` | Nothing new: brief, model, tools, connectors, memory, run page |
| Start a run as the texter | `lib/agents/summon.ts#summonAgent` → `deliverMessage` → `claimManualRun(…, { allowInactive: true })` | Add `'imessage'` to `ChannelKind` (`lib/agents/shared/channels.ts`) |
| Which model | The space's `models/` notes (default, or the brief's `model:` pin) | Nothing |
| Can do what MCP can | Brief `tools: [actions, web]` → `runAction` as the texter | Nothing |
| On/off per space | `lib/featureAccess.ts` toggleable keys (`channels` today) | Add `imessage` to `ALL_FEATURE_KEYS`, admin-only, off by default |
| Console surface | `ConsoleShell` sections (`?section=`) | New section **iMessage** |
| Person's number | Settings → Accounts (`AccountsPanel`) | New row **Phone** |
| Rate limits | `lib/rateLimit` `takeToken` (rows) | Per texter + per line |
| Background send | `/api/internal/*` + `internalAuth` | Reply job if a run outlives the webhook |

A text is a person present, so it runs like pressing **Run**: the agent need
not be switched on for unattended runs. The feature's gate is "iMessage on +
a line assigned + a `phone` brief + a runnable model".

## Data

Two tables, prefixed for the tool that owns them (migration via
`pnpm db:migrate:new`; read the SQL).

```prisma
model ImessageLine {            // imessage_lines
  id          String   @id
  spaceId     String   @unique  // one line per space
  number      String   @unique  // E.164, the Sendblue line
  name        String?           // shown name; null = the space's name
  status      String            // active | suspended
  profileAt   DateTime?         // last contact-sharing profile push
  createdAt   DateTime @default(now())
}

model ImessageLink {            // imessage_links
  id          String   @id
  userId      String
  phone       String   @unique  // E.164; one account per phone
  verifiedAt  DateTime?
  createdAt   DateTime @default(now())
}
```

Plus a thin `imessage_threads` row per (line, phone): current space (house or
room), last `message_handle` seen, and the pending link code. `ImessageLink` is
keyed by a bare `userId` → **add it to `deleteAccount`**, or
`tests/delete-account.test.ts` fails.

Env: `SENDBLUE_API_KEY_ID`, `SENDBLUE_API_SECRET`, `SENDBLUE_WEBHOOK_SECRET`.
Deployment secrets, like `OPENROUTER_API_KEY`.

## Sendblue facts the design rests on

- **One webhook for the whole account** — "you cannot set a different webhook
  per phone number". So routing is by the payload's `sendblue_number` (the line
  that received it). `from_number` is the sender.
- **Sending names the line**: `POST /api/send-message` with `from_number` (must
  be a line on the account), `number`, `content`, optional `media_url`,
  `status_callback`. Auth headers `sb-api-key-id` / `sb-api-secret-key`.
- **Retries happen** — dedupe on `message_handle`, answer 2xx fast.
- **Webhook auth is a shared secret** set per webhook or globally, sent in a
  header — *header name unverified*; no HMAC found. Compare with
  `timingSafeEqual`.
- **Media URLs expire after 30 days** — copy audio before transcribing.
- **Name & photo per line**: `POST /api/v2/contact-sharing/profile`
  (`fromNumber`, `firstName`, `lastName`, `photoUrl`), then
  `POST /api/v2/contact-sharing/share` (`fromNumber`, `toNumber`) — direct
  iMessage chats only, deduped per 24h. A `.vcf` via `media_url` also works.
- **Before a contact replies** a line may send ≤ 6 messages, ≤ 300 chars, no
  links or media. Contact-initiated threads skip new-contact limits.
- **Lines**: many per account; API provisioning only on Agent / inbound-only
  plans, 3/day and 10/month by default; pricing is quote-based.
- **Extras**: typing indicator, mark-read, tapbacks, delivery status; SMS
  fallback automatic.

## Flows

### Linking a phone (the person texts first)

Because the member messages the line first, pre-reply limits never bite.

1. Settings → Accounts → **Phone**: enter number → Visvine shows a 6-digit code
   and the space lines the person can reach.
2. The person texts the code to any of those lines.
3. Inbound sees an unverified link with a matching code from that `from_number`
   → sets `verifiedAt`, replies "Linked", pushes the line's contact profile.

A code expires in 10 minutes; codes are rate-limited per user.

### A message

1. Verify secret, dedupe `message_handle`, drop `is_outbound`.
2. `sendblue_number` → line → space. Unknown line → 200, nothing.
3. `from_number` → verified link → user. None → one reply ("This number isn't
   linked"), rate-limited, nothing runs.
4. Pick the target within the family, the texter's own standing only:
   - the house, plus rooms the texter is a member of, with a `phone` brief
     (own, or the house's `share_as: run-in`);
   - one candidate → it; a room named in the text → it; else the thread's
     current space; else Jev (`decide`, choice over the candidates) above its
     floor; else ask "Acme or Design?".
   - Not a member of the house → treated as unlinked.
5. Voice → fetch media, convert (ffmpeg → m4a), transcribe, prefix
   `🎙 "…"` in the reply. Other media (images, stickers) → "Text or voice only".
6. Typing indicator on, `summonAgent(target, 'phone', principal, text)`.
7. When the run ends, send its answer with `from_number` = the line. Any reply
   that wrote something names where: `Added to **Design** · reply "Acme" to move`.

The run's final text: `summonAgent` returns `dispatch`; the reply is the run's
answer when it settles. If that exceeds the webhook's budget, a run-end hook
sends it instead (the run knows its channel from the mailbox event). Needs a
check of how `dispatch` resolves and where the final assistant text lives
(`agent_runs.summary` is capped).

### Voice transcription

Not a chat call, so the space's model doesn't cover it. Deployment key,
metered per space like the judge's allowance. Options: OpenRouter to an
audio-input model (one vendor, existing key) or a Whisper-style endpoint
(new key). Sendblue mentions "transcription data when present" on inbound —
*field unverified*; if it carries voice-memo transcripts, use it and skip ours.

### Name and icon

- `ImessageLine.name ?? space.name`, icon = the space's `imageUrl`, read at
  push time.
- Push the profile on line creation, on name/icon change, and share it on link.
  Photo must be a public JPEG/PNG — serve a derived square from storage.

## Surfaces

- **Console → iMessage** (admin): the number, name, on/off, rooms it reaches.
  No keys, no perimeter. `Runs as the texter · 12 linked · model Claude`.
- **Settings → Accounts → Phone**: number, verified state, remove.
- **The agent page**: runs show channel `imessage` like any other.

Line assignment is Visvine's act (a super-admin console or script), not
self-serve, until pricing and provisioning limits are decided.

## Guarantees (enforced by the server)

- A run is always as a verified, current member of the space it lands in.
- The candidate set is the texter's own spaces in that family; Jev picks within
  it or nothing, and a write names where it went.
- No agent `write_context` hops into `subspaces/<id>/`: a room's run happens
  in the room.
- `phone` memory is the space's: the brief tells it to keep space facts, not a
  texter's private asks.
- No Sendblue secret leaves the server; no line is shared between spaces.

## Build order

1. Tables + migration, `deleteAccount`, seed a fake line and link.
2. `/api/imessage/inbound`: secret, dedupe, line → space, link flow.
   `scripts/imessage-fake.ts` posts payloads locally.
3. `'imessage'` channel kind, `summonAgent`, reply send. Text end to end.
4. Seeded `phone` brief recipe; Console → iMessage; Settings → Phone.
5. Voice: fetch, convert, transcribe, allowance.
6. Rooms: candidate set, sticky thread, ask, Jev, "Added to" line.
7. Contact profile push; typing indicator.
8. `docs/imessage.md` replaces this plan.

## Open questions

- Sendblue plan (Agent vs Blue Ocean) and per-line cost — decides whether a
  line is self-serve or a paid add-on.
- Webhook secret header name; inbound transcription field.
- Transcription vendor.
- Group chats: ignored for now.
