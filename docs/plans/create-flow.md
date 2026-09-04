# Create new — one panel, a flow per type

Status: built 2026-09-04 (all four phases). Kept as the record of the decisions; the
living description is the "Creating things" section of `AGENTS.md`.

## What is wrong today

- The rail's **Create new** pushes `/directory/new`: a blank context note with a
  Type row. Right for a note, wrong for an event, a person, a channel, a file.
- Two create surfaces exist and half-overlap: `features/create/components/CreateModal.tsx`
  (docked panel, four grid types, legacy forms) and
  `features/notes/components/DraftContextPanel.tsx` (note-first, eleven types,
  1538 lines carrying channel/section/file/connector/entity commit arms).
- Every type has one commit path in each of those two files. Behaviour drifts.

## The shape

Press **Create new** → the panel column beside the rail slides out, exactly as
a docked panel does (layer against the rail's edge, card-height, `translateX`
over `DOCK_MS`; the space switcher has since become a click-to-open popover). The rail already owns that column
and already mounts `CreateModal` in it (`Sidebar.tsx` "Create new — a layer
over the host"); the rail button just stops routing and starts opening it.

```
┌──────────────────────────┐
│ [🔍 Search or create…  ] │   step 0 · pick
│                          │
│  ●  Event                │   ← suggested for this page, first, no chip
│  ●  Person               │
│  ●  Space                │
│  ●  Resource             │
│  ●  Note                 │
│  ●  Folder               │
│  ●  File                 │
│  ●  Channel              │   only when channels on + admin
│  ●  Section              │
│  ●  Connector            │   admin
│  ●  Agent                │
│  ●  Tool                 │
│  ──────────              │   hairline
│  ●  Playbook             │   the space's own types
│  ●  Deal                 │
│  +  New type "Memo"      │   only while the search matches nothing
└──────────────────────────┘
```

Rows are a coloured dot (the type's colour, `getNodeTypeConfig`) and the name.
No descriptions, no "You're on Events" chip, no section titles. Suggestion is
expressed by order alone.

Picking a row does one of three things, and a pure table says which:

| flow | meaning |
|---|---|
| `inline` | step 1 renders in the same panel: a short form, one **Create** button |
| `route` | the panel closes and the type's own surface opens |
| `draft` | `/directory/new?type=…` — the context note, for things that ARE prose |

## Every type

| type | flow | step 1 / destination | writes | lands |
|---|---|---|---|---|
| **Event** | route | `/events/new` — `EventComposer` is already the create UI (poster, date, place, RSVP). Nothing to collect first. | composer autosaves `POST /api/events` | composer |
| **Person** | inline | photo · name · email · role · company · LinkedIn · location · tags. Duplicate matches (`MatchPanel`) appear under the name as you type; picking one fills the rows and carries `identityId`. Alias chips (`aliasesForType`) inline under tags when the space has any — not a separate step. | `POST /api/directory/entities` | `/directory/person:<slug>` |
| **Space** (record) | inline | name · tagline · website · HQ · logo. Name matches against live spaces; picking one sets `spaceRef` and shows "Links to *X*". | `POST /api/directory/entities` | `/directory/space:<slug>?tab=context` |
| **Resource** | inline | first row is the thing: paste a link **or** drop a file. Link → name (prefilled from the URL's host), description, tags. File → Drive upload into the picked folder. | link: `POST /api/directory/entities`; file: `driveApi.upload` | resource page / `/directory?view=resources` |
| **Note** | draft | `/directory/new?type=note` (unchanged) | `notesApi.create` | the note |
| **Folder** | inline | name · destination (`FolderPicker`) | `notesApi.createFolder` | the index note |
| **File** | inline | drop zone · destination. `FileForm` as it is, minus the explainer paragraph. | `notesApi.uploadSource` | source, or `/directory/note/index.md` when several |
| **Channel** | inline | icon + name · Chat/Feed segment · section (only if any exist) | `POST /api/messages/conversations/channel` | `/channels/<id>` |
| **Section** | inline | name | `POST /api/messages/sections` | `/channels` |
| **Connector** | route | `/admin?section=connectors&tab=add` — the catalogue is the create UI (one press, sign-in, or the form). "Write your own" stays a catalogue row. | as today | as today |
| **Agent** | draft | step 1 is the starter list from `AgentDraftSetup` (Blank first) → `/directory/new?type=agent&template=<id>`. The brief is prose, so the editor is the right place; the panel only picks the starting point. | `notesApi.create(agentBriefPath)` | `/directory/agent:<name>` |
| **Tool** | inline | name (slug, mono) · title · rail label. Drop the description row and the two explainer sentences; the preview page says the rest. | `POST …/tools/authoring` | `/tools/preview/<name>` |
| **Model** | route | opens the Models dialog (`?models=` on the current page), admins only | as today | dialog |
| **space's own type** (`scope: 'note'`) | draft | `/directory/new?type=<Name>` with the Type row preset and locked to that colour | `notesApi.create` with `type:` | the note |
| **New type** | inline | one row: the name you typed, a colour swatch strip (`TAG_SWATCHES`) → Create | `PATCH …/node-types` then the draft above | the draft |

Not in the list, deliberately:

- **Starting a space you run** stays on the switcher (`NewSpaceDialog`) and on
  the parent's Sub-spaces section. It is the one act that takes you somewhere
  else. A search for "space" still finds the record type only.
- **Model** is a row only for admins; members never see it.

## Ordering and search

`lib/create/rank.ts` (pure, tested):

1. Rows = built-ins the space enables (`DEFAULT_NODE_TYPES` × `isNodeTypeEnabled`
   × `canCreateType`) + Note, Folder, File + Model (admin) + the space's
   `nodeTypes` with `scope: 'note'` (minus `isReservedTypeName`).
2. No query: the route's suggestion (`suggestedCreateType(pathname).types`)
   first in its own order, then built-ins in `DEFAULT_NODE_TYPES` order, a
   hairline, then the space's types alphabetically. `reason` strings are
   dropped from `suggestedType.ts` — nothing renders them.
3. Query: `scoreSpace`-style ranking (exact > prefix > word-start > substring),
   flat, hairline gone. When nothing matches exactly and the name is legal
   (`normalizeTypeName`, not reserved, not a synonym) the last row is
   **New type "…"**; a synonym ("company") ranks the built-in it folds onto.
4. Arrow keys, Enter picks, Escape closes (step 0) or goes back (step 1).
   Search autofocuses after the slide, as the switcher does.

## Panel mechanics

- `features/create/components/CreatePanel.tsx` replaces `CreateModal.tsx`:
  the aside, the search, the list, and a step host. Same `useCreateModal`
  context; `open(type?)` with a type skips to step 1.
- Step 1 header: a back chevron and the type's dot + name. Nothing else.
- One footer button, **Create** (or **Upload** for File). Disabled until the
  type's `ready()` says so. No success screen: creating navigates, the panel
  closes on the route change (existing `pathname` effect), and the thing you
  made is on screen.
- Width: the column's `createW` goes from 300 to **360px** so the person and
  channel forms fit one column without wrapping. The switcher inherits the
  same width (it reads `createW`); fine.
- Labels: placeholder text IS the label (`NewSpaceDialog` already does this).
  The only visible words in a form are placeholders, the segment options, and
  the button. Required rows carry no asterisk; the button stays disabled.
- Forms share one `EntityRows` component driven by
  `lib/create/typeFields.ts#fieldsForType` for Person / Space / Resource, so
  the create form, the profile's property rows and the Directory table are one
  schema. Person gains `companyName` and `linkedinUrl` rows for free.
- `useCreateSurface(type, { folder })` stays as the deep entry point (the
  context tree's "+", the channel list) and now calls `open(type)`; the draft
  route is reached only through the `draft` flow.

## Files

New

- `lib/create/flows.ts` — `flowFor(type, ctx)` → `inline | route | draft` plus
  the href builder. Pure. `tests/create-flows.test.ts` asserts every
  `CreateableType`, every `DEFAULT_NODE_TYPES` name and a custom type resolve.
- `lib/create/rank.ts` — rows, ordering, search, the new-type row.
  `tests/create-rank.test.ts`.
- `features/create/components/CreatePanel.tsx` — shell.
- `features/create/components/TypeList.tsx` — rows + keyboard.
- `features/create/components/forms/` — `PersonForm`, `SpaceRecordForm`,
  `ResourceForm`, `FolderForm`, `FileForm`, `ChannelForm`, `SectionForm`,
  `ToolForm`, `NewTypeForm`, `AgentStarters`, and `EntityRows`.

Changed

- `Sidebar.tsx` — Create new row → `open()`; mount `CreatePanel`; `createW` 360.
- `CreateModalContext.tsx` — `NOTE_FIRST` table goes; `useCreateSurface` asks
  `flowFor`.
- `DraftContextPanel.tsx` — keeps `note`, `folder`, `agent` and custom types.
  Loses the `person/space/resource/event/channel/section/file/connector`
  arms, `ChannelExtras`, the `FileForm` host, `ENTITY_TYPES`, the matches
  popover and `conflict` banner (they move into `PersonForm` /
  `SpaceRecordForm`). Accepts `?type=<custom name>` and `?template=`.
- `app/(auth)/directory/new/page.tsx` — `DRAFT_TYPES` shrinks; a `?type=`
  that is neither built-in nor in `currentSpace.nodeTypes` leaves the row unset.
- `suggestedType.ts` — drop `reason`.
- `creatable.ts` — add `model` (admin) and keep everything else.

Removed

- `CreateModal.tsx`, `CreateModalForms.tsx` (`LocationAutocomplete` moves to
  `components/ui/` or `features/create/components/forms/`, since
  `PropertyRows` imports it), `AliasSelector`, `SuccessScreen`, `TYPE_OPTIONS`.
- The note-first event path: `EVENT_FIELDS` in `typeFields.ts` stays only if
  the profile's details section still reads it — check `PropertyRows` callers;
  if events render their own detail block, delete it.

## Order of work

1. **Shell + list + flows table.** Every row routes to what exists today
   (draft surface for the inline ones, for now). Ships alone; nothing regresses.
2. **Inline forms**, one type per commit: Folder, File, Section, Channel (the
   four that already have panel forms), then Tool, then Person / Space /
   Resource on `EntityRows`.
3. **New type + custom types** into the draft via `?type=<Name>`; Agent
   starters step.
4. **Retire** the legacy files and the DraftContextPanel arms. `knip` is the
   check that nothing is left dangling.
5. `pnpm typecheck`, `pnpm lint --max-warnings=0`, `pnpm test`,
   `pnpm --filter @visvine/web knip`.

## Decisions taken here, flag if wrong

- Event goes straight to the composer. Collecting title/date in the panel
  first would be a second event form to keep in sync with the composer.
- Connector goes to the console catalogue rather than rendering the catalogue
  in the panel. The panel version is a natural follow-up once the shell
  exists; the catalogue rows are the same shape as type rows.
- A Space row makes a **record**. Provisioning stays on the switcher.
- No success screen anywhere. The created thing is the confirmation.
