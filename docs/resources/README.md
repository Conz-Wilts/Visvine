# Resources

Every file and link a space holds, Slack's way: **one resource, many shares.**
A file uploaded once and posted into three channels is one `Resource` with
three `ResourceShare`s; the same Google Sheet pasted five times is one resource
(unique per space by canonical URL) with five. Every resource is a context
entity — `resource:<slug>` and `resources/<slug>/index.md` — so it has a page,
backlinks, mentions and search like any other entity, and agents reach it
through the same actions people's AIs use.

`PLAN.md` is the design record: the research, the audit of what came before,
and the phases this was built in. `mobile.md` is the spec for the native
clients. This file is how it works now.

## The model

| Table | Holds |
|---|---|
| `resources` | the thing itself. `source` upload \| link; `kind` (`lib/resources/shared/kinds.ts`); `state` uploading \| ready \| failed \| deleted; `node_id`; an upload's `gcs_path`, `mime_type`, `content_hash`, dimensions, `page_count`, `scan_state`; a link's `url`, `canonical_url`, `provider`, `unfurl`, `embed_url`, `preview_path`, `fetch_state`, `entity_source`, `external`; `deleted_at` for the trash |
| `resource_shares` | where it was shared: `conversation_id` null = the space itself, else a channel, with the `message_id` that carried it, `shared_by`, `agent_name`, `via` (upload \| message \| link \| action \| agent) |
| `resource_renditions` | `thumb` 360 px, `preview` 2048 px, `poster`, `page1` — WebP drawn from pixels, so EXIF never survives into one |
| `resource_jobs` | work a resource owes: `rendition`, `extract`, `unfurl`, `refresh` |
| `resource_access` | who used what, how and through which door: `read`, `download`, `upload`, `share`, `use` (as a cover or a picture, with `target_node_id`), `delete`; `via` web \| mcp \| agent \| api, with the agent's name and run |

`fileType`, `uploadedBy`, `conversationId` and `metadata.fileId` are the
previous shape's columns, kept until a drop migration; nothing new reads them.
`db:resources:reshape` moved the old rows into this shape and runs as a seed
step.

## Who sees what

**Visibility is the union of shares** (`lib/resources/shared/visibility.ts`,
pure): an admin sees everything; anyone else sees a resource when one of its
shares reaches them — a space share reaches every active member, a channel
share that channel's members. A resource with no share, or in the trash, is
its creator's (and the admins') alone. `visibility.ts#visibleResourceWhere` is
the same rule as a Prisma filter, one `EXISTS` per row, and
`requireVisibleResource` is the one-row check every byte door and every action
asks. Anything refused is a 404, the same as absent.

**The note follows the same rule** through the `channel` grant subject:
`grants.ts#syncResourceGrants` is the one writer — a space share leaves the
entity folder open; channel-only shares restrict it and grant each sharing
channel. So search, the tree, backlinks and the extracted text (indexed under
the entity folder) all inherit the audience without a check of their own.

**Private channels** (`Conversation.visibility`) are listed only to their
members, cannot be joined, only added to, and restrict their own note the same
way. A file shared into one is that channel's until someone who can see it
shares it wider.

**Bytes** only ever come through `/api/resources/<id>/raw` (the original;
`?download=1` names it) and `/thumb?kind=` (a rendition): the gate, then a 302
to a signed URL that lives five minutes. A signed URL is never stored, put in a
message, or returned by an action.

## Uploads

Every way a file arrives ends in `service.ts#finishUpload`: the composer, a
drop onto a channel, the Resources view, `upload_file`, and `request_upload`'s
token.

1. `POST /api/resources/uploads` — gates, refuses a blocked name
   (`shared/uploadPolicy.ts`: executables and scripts), makes the row
   `uploading`, and opens a resumable session: a GCS session URI in
   production, or `PUT /api/resources/uploads/<id>` on the local driver.
2. The client (`features/resources/lib/upload.ts`) sends 8 MiB chunks with
   `Content-Range`; after a drop it asks `bytes */<size>` and resumes from the
   `308`'s `Range`. Production bytes go browser → bucket, so the bucket needs
   CORS (`docs/runbook.md`).
3. `POST …/uploads/<id>/complete` — stats the object, sniffs its head with
   `file-type` (the bytes must agree with the name), records the hash and
   dimensions, then `finishUpload`: the entity, the share, the grants, and the
   owed jobs, drained for up to 8 s in the request.

Originals are never re-encoded. SVG is only ever drawn through `<img>`; HTML
and XML are shown as text. HEIC has no rendition (sharp's prebuild cannot
decode it) and opens as a download. There is no virus scanner yet:
`scan.ts#configureScanner` is the seam, and `scan_state` says `skipped`.

## Jobs

The runtime throttles CPU after a response and scales to zero, so owed work is
rows, never a promise left running. `jobs.ts#drainJobs` claims with
`FOR UPDATE SKIP LOCKED` plus a re-check inside the update, so racing drains
split the work. It runs three ways: inline within a budget where a request is
already paying, `POST /api/resources/jobs/pull { ids }` from a client drawing a
pending card or a missing thumb, and the minute tick
(`/api/internal/agents/tick`) as the backstop — which also reaps uploads
nobody finished and deletes resources 30 days into the trash. Retries back off
1 m, 5 m, 30 m, 3 h, then fail.

Renditions (`renditions.ts`): images → `thumb` + `preview`; PDFs → text, page
count and `page1` (unpdf + `@napi-rs/canvas`); decks → their embedded
thumbnail and slide text; documents and sheets → text. A video's poster is
grabbed by the uploader's browser and posted as its `poster`.

## Links

`sendMessage` and `editMessage` read the text's URLs (at most five),
canonicalise each (`lib/links/shared/providers.ts`: tracking parameters off, a
Google file to its `/d/<id>`, `youtu.be` to `watch?v=`), upsert the space's
resource for it and share it on the message. The card draws at once from the
row — a skeleton while `fetch_state` is pending — and fills in when the unfurl
lands, announced as `resource.updated` on the messages stream.

The unfurl (`unfurl.ts`), in order: the sharer's own connected Google account
for a Drive file (`providers/googleDrive.ts`, as the sharer, thumbnail
re-hosted); a known provider's oEmbed endpoint; the page's own oEmbed; JSON-LD;
Open Graph; Twitter tags; `<title>`. Only the head is read, every hop is
SSRF-checked by name and again at connect (`lib/net/ssrf.ts`), and the page's
image and favicon are re-hosted as renditions — nothing is hotlinked. An oEmbed
`html` is never stored or drawn. A link older than 7 days is refreshed when it
is shared again or opened.

Removing a card (`DELETE …/messages/<id>/shares/<resourceId>`, the author or a
channel admin) removes that share; the link text stays. When a link that only
messages ever carried loses its last share, it goes to the trash. An edit moves
the cards with the text and never brings a removed one back.

Embeds are built by us for an allowlist (`providers.ts`: Google Docs, Sheets,
Slides and Drive, YouTube, Vimeo, Loom, Figma), whose hosts are the CSP's
`frame-src`. Any other page is a card.

## Surfaces

- **The viewer** (`features/resources/viewer/`, chrome in `@visvine/ui`'s
  `ResourceViewer`) — full screen, or stepped down to a side panel, addressed
  on the URL (`?resource=<id>`, `&panel=1`). A pure registry picks the renderer per kind:
  the original image with zoom and pan, react-pdf with a page rail,
  docx-preview in a sandboxed frame, SheetJS for sheets, the deck's thumbnail
  and outline, markdown and code as text, native media, an allowlisted embed,
  or the designed fallback. ←/→ walk the list it was opened from.
- **Directory → Resources** and **a channel's Files tab** are one
  `ResourcesBrowser` over `GET /api/spaces/<id>/resources`
  (`lib/resources/list.ts`, the one list query): kind chips, Mine, channel,
  person and date filters, search that reads names, link titles and the text
  inside files, list or grid (images get an image-first grid), bulk select,
  and the trash for whoever may restore.
- **Messages** draw image shares as a grid, other files as rows and links as
  cards, all opening the viewer; the composer attaches a new file or one from
  Resources.
- **The desktop app** opens an upload in the computer's own app, or Quick Look
  on macOS (`apps/desktop/src/files.ts`), from a cache under the app's
  userData that is kept under 1 GB and cleared on sign-out.

## Actions

| Action | Does |
|---|---|
| `list_resources` | the list above as a tool; every space when `space_id` is omitted. Rows carry `resource_id`, shares with their `message_href`, `readable`, `usable_as_cover`. (`list_drive` is an alias) |
| `read_resource` | one resource: its facts, shares, note and a page of its text |
| `share_resource` | posts it into a channel as the caller (`messages:write`) |
| `upload_file` | a file into the space, or with `channel_id` into a channel as a post |
| `set_image`, `create_event` / `update_event` `cover_resource_id` | use an image the caller can see; recorded as a `use` |
| `search_context` | a hit on a resource's note or text carries `resource_id` and `read_with: read_resource` |

An agent sees exactly what the person it runs as sees, and its shares and uses
are stamped with its name. `tests/resources-event-logo.test.ts` is the whole
path: a logo in a private channel, found, made an event's cover, refused to
someone outside the channel, and recorded per door.

## Tests

`resource-visibility`, `channel-grants`, `upload-policy`, `resource-renditions`,
`link-providers`, `link-unfurl`, `ssrf-fetch`, `viewer-registry` are pure;
`resource-uploads`, `resource-shares`, `resource-list` and
`resources-event-logo` run against the local Postgres and skip without it
(`tests/support/localDb.ts`). The desktop's cache rules are
`apps/desktop/tests/resource-cache.test.mjs`.
