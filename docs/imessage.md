# iMessage

A space can have its own iMessage number. Members text it — typed, or dictated
with the keyboard's mic, which arrives as the same text — and the space's
`phone` agent does the work **as them**: search and add context, run
connectors, create events, anything the action registry does. The reply is
the run's summary, texted back from the same number. The number carries the
space's name and icon.

It is a **platform feature, not a connector**. Visvine owns one Sendblue
account; each space is assigned a line on it. No space holds a Sendblue key,
edits a perimeter, or sees another space's line.

```
member's iPhone ──text──────▶ space's line (Sendblue)
      ▲                             │  one webhook, account-wide
      │                             ▼
      │                POST /api/hooks/imessage          lib/imessage/service.ts
      │                  sb-signing-secret · dedupe message_handle
      │                  sendblue_number → line → space
      │                  from_number     → verified link → user
      │                  house or room?  (the texter's own standing)
      │                             ▼
      │                summonAgent(target, 'phone', principal, text)
      │                  channel 'imessage' · manual run as the texter
      │                             ▼
      └──────reply◀── run ends → answerChannels → reply.ts → send-message
```

## Where things live

| | |
|---|---|
| Pure layer | `lib/imessage/shared/` — `phone` (E.164), `inbound` (payload → text), `link` (codes), `targets` (house or room), `reply` (the text back), `brief` (the starter agent) |
| Sendblue client | `lib/imessage/sendblue.ts` — send, typing, contact-sharing profile/share, `GET /api/lines`; `webhookSecretMatches` |
| Inbound | `lib/imessage/service.ts#handleInbound`, behind `app/api/hooks/imessage/route.ts` |
| Reply | `lib/imessage/reply.ts#replyForRun`, called by `lib/agents/channelReplies.ts#answerChannels` from the runner on every finished run |
| Lines, links, threads | `lib/imessage/{lines,links,targets}.ts` |
| Console | `lib/imessage/console.ts` ↔ `GET/PATCH /api/spaces/<id>/imessage`, `PUT/DELETE …/imessage/line` (super-admin), `POST …/imessage/agent`; `features/imessage/components/ImessagePanel.tsx` |
| Settings | `GET/POST/DELETE /api/account/imessage`; `features/imessage/components/PhonePanel.tsx` |
| Tables | `imessage_lines`, `imessage_links`, `imessage_threads`, `imessage_inbound` (`prisma/TABLES.md`) |
| Env | `SENDBLUE_API_KEY_ID`, `SENDBLUE_API_SECRET`, `SENDBLUE_WEBHOOK_SECRET` — deployment secrets, like `OPENROUTER_API_KEY` |
| Local | `pnpm --filter @visvine/web imessage:fake "…"` posts a text from a seeded phone |

## What already existed, and what changed

- **The brain is an ordinary agent**: `agents/phone/index.md`. Brief, model,
  tools, connectors, memory, run page — nothing new. `shared/brief.ts` is
  only its starting text; Console → iMessage's *Add the phone agent* and the
  seed write it through `createAgentBrief`. **Its folder carries a space-wide
  VIEW grant**: a run acts as the texter and the runner refuses a run whose
  person cannot read the brief, so "every member may text the line" and
  "every member may read `agents/phone`" are one fact. An admin narrows it on
  the note's Share panel like any grant — and then only those people's texts
  run.
- **A text is a person present**, so it runs like pressing Run: through
  `summonAgent` → `deliverMessage` → `claimManualRun(…, { allowInactive })`,
  as the texter, whether or not the agent is switched on for unattended runs.
  Two things were added to that path for it:
  - `deliverMessage` takes `{ allowInactive }` and an already-resolved sender
    (`from.userId`) — membership is still checked; knowing who someone is
    never says they belong here. `summonAgent` passes both.
  - `summonAgent` takes `gate: 'member'`. The page's rule (`canTriggerRun`:
    the author, or anyone who can edit the brief) is not the phone's: an
    admin switching iMessage on for the space IS the decision that every
    member may make `phone` run. Nothing else uses it.
- **The reply address rides the mailbox event.** `InboundMessage.payload` is
  stored beside the message on the `agent_events` row (never shown to the
  model); `reply.ts` reads `payload.imessage` off the events the run consumed.
- **One sender.** The webhook waits `IMESSAGE_AWAIT_MS` (35 s, under
  Sendblue's 45) and answers 200; the run keeps going and the runner's
  `answerChannels` sends the summary when it ends — the same way whether the
  run finished inside the budget or not. In `inline` dispatch (dev) the wait
  is what carries the run; in `self` dispatch it is already on another
  instance.
- `'imessage'` is a `ChannelKind`; `imessage` is a feature key — toggleable,
  admin-only, nav-hidden (`lib/featureAccess.ts`). A new space starts with it
  off. The switch is in Console → iMessage's header, not the Tools list.

## Sendblue facts the design rests on (verified 2026-09-22)

- **One webhook for the whole account** — "you cannot set a different webhook
  per phone number". Routing is by `sendblue_number`; `from_number` is the
  sender.
- **Auth on the way in is a shared secret** in the `sb-signing-secret` header
  (no HMAC). Compared with `timingSafeEqual`. Absent or short config closes
  the door (503) rather than opening it.
- **Sending**: `POST https://api.sendblue.com/api/send-message` with
  `from_number` (a line on the account), `number`, `content`; headers
  `sb-api-key-id` / `sb-api-secret-key`. Typing: `POST /api/send-typing-indicator`
  (`number`, `from_number`, `state`, `max_duration_ms` ≤ 300000; iMessage
  only, existing conversation only). Lines: `GET /api/lines`.
- **Retries**: up to 3 on 5xx, 45 s timeout. So: dedupe on `message_handle`
  (`imessage_inbound`, kept a week), answer 2xx for everything that is not a
  provider auth failure, and never 5xx on purpose.
- **Name & photo**: `POST /api/v2/contact-sharing/profile` (`fromNumber`,
  `firstName`, `lastName`, `photoUrl` public JPEG/PNG), then
  `POST /api/v2/contact-sharing/share` (`fromNumber`, `toNumber`) — direct
  iMessage chats only, deduped per 24 h. Pushed on assign and rename, shared
  on link.
- **Before a contact replies** a line may send ≤ 6 messages, ≤ 300 chars, no
  links/media. The person always texts first, so this never bites.
- **Limits** (Blue Ocean): 50 new contacts/line/day, 10 msg/s/line.

## Flows

### Linking a phone

1. Settings → Accounts → **Phone**: enter a number. `startLink` writes an
   unverified `imessage_links` row with a 6-digit code (10 min, 5 codes per
   10 min per user) and the page shows the code and the lines the person can
   reach (spaces they are in that hold one).
2. The person texts the code to any of those lines.
3. `handleInbound` sees a phone with no verified link and a six-digit text →
   `verifyLinkCode` → "Linked. Texts here run as Ana." → the line's card is
   shared into the conversation.

One phone per account (`phone` is unique; a new `startLink` replaces the
person's earlier phone). An unverified claim by someone else on the same
phone gives way to a new claim — possession decides. `imessage_links`
cascades from `users`, so account deletion needs nothing extra
(`tests/delete-account.test.ts` sees the cascade).

### A message

1. `readInbound`: drop `is_outbound`, group messages and status callbacks;
   media with no text is `not_text`.
2. `imessage_inbound` insert; a seen handle is `deduped`.
3. `sendblue_number` → line → space. Unknown line → 200, nothing.
4. Per-phone pace: 12 burst, one per 5 s sustained; over it, silence.
5. `from_number` → verified link → user. None: a code is redeemed, or
   "This number isn't linked…" **once an hour**.
6. Not text → "Text only".
7. Line suspended or the switch off → "iMessage is switched off" once an hour.
8. Candidates (`targets.ts#candidatesFor`): the house if the texter is an
   active member AND it has a `phone` agent; each room under it the texter
   is an active member of that has a `phone` agent_state row — its own brief
   or a run-in copy of the house's (`shared_from`). Empty: "not a member" or
   "no phone agent yet".
9. `pickTarget` (pure): one candidate → it; the text is only a room's name →
   switch the thread, reply "Now in Design", run nothing; a room named in the
   text → it; the thread's current space → stay; else the judge
   (`imessageTargetQuestion`, floor 0.6, `unclear` allowed); else ask
   "Acme or Design?".
10. `resolveContext` + `principalOf` for the texter in the target space —
    the same gate every route uses. Typing indicator on.
11. `summonAgent(target, 'phone', principal, text, { channel: 'imessage',
    externalId: 'sendblue:<handle>', payload: { imessage: address },
    gate: 'member' })`. Busy → "Still working on your last message".
12. Wait ≤ 35 s, answer 200. When the run ends, `replyForRun` texts
    `replyText(...)`: the summary flattened to plain text (`plainText`),
    capped at 3 000 chars; on failure one line; and, only when the texter had
    more than one candidate, "— Saved in Design" / "— In Design".

### Name and icon

`ImessageLine.name ?? space.name`, icon = the space's `imageUrl` made
absolute on `NEXT_PUBLIC_APP_URL` (a local-driver URL is not pushed).
`pushLineProfile` runs on assign and rename; `shareProfileWith` on link.

## Surfaces

- **Console → iMessage** (admin): the header carries the switch; one muted
  line: `Runs as the texter · 12 linked · also answers Design`. Rows: the
  line (number, the shown-name field, On/Off/Not ready), the phone agent
  (opens its page) or *Add the phone agent*. A warning line only when
  Sendblue is unconfigured, the line is suspended, or the space has no
  runnable model. A super-admin also sees *Assign a line* (the account's
  lines, from `GET /api/lines`, or a typed number) and *Remove*.
- **Settings → Accounts → Phone**: enter a number; the code with the lines to
  text it to (`sms:` links); the masked number with Linked and Unlink. Drawn
  only when the person can reach at least one line or has a phone.
- **The agent page**: runs show `imessage:<name>` as their source like any
  channel.

Line assignment is Visvine's act until pricing and provisioning limits are
decided; nothing in a space can mint one.

## Guarantees (enforced by the server)

- A run is always as a verified, current member of the space it lands in
  (`userForPhone` → `resolveContext`; `deliverMessage` checks membership
  again).
- The candidate set is the texter's own spaces in that family; the judge picks
  within it or nothing, and a reply names where it went when there was a
  choice.
- No agent `write_context` hops into `subspaces/<id>/`: a room's run happens
  in the room, as a run of the room's agent (or the house's run-in copy).
- `phone` memory is the space's: the brief tells it to keep space facts, not a
  texter's private asks.
- No Sendblue secret leaves the server; no line is shared between spaces
  (`number` and `space_id` are both unique).
- A stranger's phone hears one line an hour; nothing it sends starts a run.

## Open

- Sendblue plan and per-line cost — decides whether a line becomes
  self-serve.
- Group chats: ignored (`group_id` present → nothing).
- `imessage_lines.status = 'suspended'` is written by nobody yet; it exists
  so a super-admin script can pause a line without unassigning it.
