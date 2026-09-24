# Resources, redesigned — PLAN

> On approval, this file is committed verbatim as `docs/resources/PLAN.md` and
> `docs/resources.md` moves to `docs/resources/README.md`, rewritten at the end
> of Phase 5. After that commit, work stops until you start Phase 1.

## Context

The Resources tab brought back in `0cb5df27`/`09c98605` (plan *merry-painting-sunbeam*)
treats a resource as the outcome of whichever table happened to store it. There
are four sources, merged in memory at 150 rows each. A link lives in three
places at once: a `resource` node with `url`, a `link_previews` row, and a
`message_link_previews` row. Channel files have no node, so agents can't reach
them. Preview images are hotlinked. The viewer is an `<iframe src=pdf>`. There
is no Files tab in channels, and no resumable uploads, renditions or PDF text.
Unfurls are fire-and-forget on a runtime that throttles CPU once the response
has gone (`docs/runbook.md:259`), so they can quietly never land.

The goal is Slack's model, made ours: **one resource, many shares**. Every
resource is a context entity. There is one viewer (a flexpane, then full
screen). Agents use the same doors as people.

Decisions already taken with you: **light theme only** (`dark.json` stays
provisional and untouched); **private channels are added in Phase 1**; **no
Office converter service**; **type checks now, virus scanner later** behind an
interface.

---

## 1. Research

### Slack's model (the reference)
- **Resource vs. share.** `files.remote.add` registers a link as a file object:
  `external_id`, `external_url`, `title`, `filetype`, a `preview_image` that
  Slack itself stores, and `indexable_file_contents` for search. Adding it
  makes it visible **nowhere**. `files.remote.share` posts it into channels.
  Hosted uploads work the same way: `files.getUploadURLExternal`, then a PUT of
  the bytes, then `completeUploadExternal`. The File object then carries
  `shares` and `channels`. → *The resource and where it was shared are two
  things.* [working-with-files](https://docs.slack.dev/messaging/working-with-files/)
- **Unfurl + flexpane (Work Objects).** The unfurl card is what everyone in the
  conversation sees. The flexpane (right sidebar) opens on click and may
  require sign-in to the provider.
  - A file entity is `slack#/entities/file`, with:
    - attributes `title`, `display_id`, `display_type`, `product_name`,
      `product_icon`, `full_size_preview{is_supported,preview_url,mime_type}`,
      `metadata_last_modified`;
    - fields `preview`, `created_by`, `date_created`, `date_updated`,
      `last_modified_by`, `file_size`, `mime_type`;
    - plus `custom_fields`, ≤2 `primary_actions` and ≤5 `overflow_actions`.
  - The event flow is `link_shared` → `chat.unfurl(metadata.entities)` →
    `entity_details_requested` → `entity.presentDetails`.
  - File entities carrying a `slack_file` are listed in Slack's unified files
    browser automatically.
  - [work-objects](https://docs.slack.dev/messaging/work-objects),
    [implementation](https://docs.slack.dev/messaging/work-objects-implementation/)
- **Embeds.** `preview_url` must be HTTPS and cross-origin. It must set
  `frame-ancestors`, use signed URLs that live ≤10 min, and sit on an
  admin-set domain allowlist (single-level wildcards). It runs sandboxed with
  `Origin: null` by default; scripts are allowed and there is no postMessage.
  **When an embed fails to load, Slack falls back to the card.**
  [work-objects-embeds](https://docs.slack.dev/messaging/work-objects-embeds/)
- Your screenshots show: the Files browser (All / Created by you / Shared with
  you, Types, sort, one row per file with an icon tile, name, `owner · when`,
  and hover actions), and a PDF viewer (header `avatar · name / when – file`,
  a page-thumbnail rail, the page on a dark stage, and download / open /
  overflow at the bottom right).

### Viewer UX: Mattermost `file_preview_modal`
- **Structure:** `header` / `main_nav` (prev/next) / `main_actions` /
  `popover_bar` / `info` / `footer`. `PDFPreview` is `React.lazy`, plus
  `CodePreview`. Anything else gets `FileInfoPreview` (icon + name + download).
  [source](https://github.com/mattermost/mattermost/tree/master/webapp/channels/src/components/file_preview_modal)
- **Zoom** (`ZoomSettings`): 1.0 for images and 1.75 for PDFs by default; step
  0.25; min 0.25; max 3.0 (2.0 for images). Zoom follows the cursor, and you
  can drag to pan only while zoomed in. ←/→ move between files.
- **Their bug to avoid:** the modal shows a server *preview* image, so
  right-click → Save saves the preview, not the original
  ([desktop#707](https://github.com/mattermost/desktop/issues/707) is the
  same family). **We set `src` to the original wherever the browser can decode
  it.** Where a rendition must stand in (HEIC, >40 MP), the context menu is ours
  and offers *Save original*.

### Viewer libraries (npm on 2026-09-24): pick per format

| Format | Pick | Why | Rejected |
|---|---|---|---|
| PDF | **react-pdf 11.0** (MIT) over pdfjs-dist 6.3 (Apache-2.0) | Maintained; text layer; lazy per page; the worker is a static asset; works in Electron (same web bundle) | — |
| DOCX | **docx-preview 0.4.1** (Apache-2.0, 1 dep) | Client-side and far more faithful than mammoth's HTML; restyled with our tokens through its class prefix | mammoth HTML route (drops layout; also skips the channel gate, see §2) |
| XLSX/CSV | **SheetJS 0.20.3** (already vendored from cdn.sheetjs.com, `apps/web/package.json:107`) | Already a dependency; the existing `SpreadsheetViewer` carries cell comments and changes | npm `xlsx@0.18.5` (stale, CVEs), exceljs (heavier) |
| PPTX | embedded `docProps/thumbnail.jpeg` + slide text (fflate) | No converter (your call) | pptx-preview (low fidelity) |
| Media | native `<video>`/`<audio>` | Range requests work through the signed redirect | video.js |
| Code/text/md | our note markdown renderer; `<pre>` with line numbers | No shiki (~1 MB of grammars) | — |
| Multi-format kits | — | — | **@cyntler/react-doc-viewer 1.17** (styled-components, react-pdf 9, last publish 2025-09, can't take CSS-var tokens cleanly); **@iamjariwala/react-doc-viewer 1.9** (pins react-pdf 9, brings its own chrome); **anyview 0.2** (pre-1.0, peer on xlsx 0.18.5); **@eternalheart/react-file-preview 1.6** (26 deps incl. three.js, video.js, framer-motion, lucide; React 18 peer) |

All picks are loaded with `dynamic(..., { ssr: false })` per renderer, so the
Resources route pays only for what it opens. The heavy renderers live in
`apps/web`. `@visvine/ui` keeps its rule of "tokens and nothing else" (see §5).

### Link unfurling
| Lib | Fetches? | SSRF | OG/Twitter/JSON-LD/oEmbed | Verdict |
|---|---|---|---|---|
| [linkpeek](https://www.npmjs.com/package/linkpeek) 2.1.5 | yes, or `parseHTML(html, base)` | validates each redirect, but blocks **literal** private IPs only ("runtime fetch owns DNS") | ✓ / ✓ / ✓ / discovery only | Good parser, weaker SSRF than ours |
| open-graph-scraper 6.12 | yes (undici) | none built in | ✓ / ✓ / partial / ✗ | no |
| metascraper 5.58 | html in | n/a | ✓ via rule bundles (cheerio) | heavy for a card |
| unfurl.js 6.4 | yes (node-fetch 2) | none | ✓ incl. oEmbed | last publish 2024-02 |

**Decision:** keep our own fetcher, `lib/linkPreview.ts#ssrfSafeFetch`, because
it resolves DNS and checks every hop (`lib/net/ssrf.ts`). Keep our pure parser,
`lib/links/shared/unfurl.ts` (tested), and add **JSON-LD**
(`headline`/`name`, `author`, `datePublished`, `image`) plus canonical-link
handling. A new library would duplicate a tested module and bring a weaker
network gate.

- **Provider embeds** (the allowlist; we build every embed URL ourselves and
  never render oEmbed `html`):
  - Google Docs/Sheets/Slides: `docs.google.com/{document|spreadsheets|presentation}/d/<id>/preview`.
    A private file shows Google's sign-in inside the frame, and Safari blocks
    third-party cookies, so the fallback card matters.
  - Drive files: `drive.google.com/file/d/<id>/preview`.
  - YouTube: `youtube-nocookie.com/embed/<id>`.
  - Figma: `embed.figma.com/...?embed-host=visvine`.
  - Loom: `loom.com/embed/<id>`.
  - Vimeo: `player.vimeo.com/video/<id>`.
  - Everything else gets the rich card. **No arbitrary-site iframes**; today
    `ResourcePreviewContent` frames any site that doesn't forbid it, which is
    a phishing surface in our chrome.
- **Connector as the entity source** (Slack's "the provider's app supplies the
  entity"): when the sharer has a Google account connected
  (`connector_accounts`, `service.ts#connectionFor`), the unfurl job calls
  Drive `files.get` (`name, mimeType, modifiedTime, owners, size,
  thumbnailLink`) **as the sharer**. The thumbnail is fetched with the token and
  re-hosted by us. `thumbnailLink` is short-lived and CORS-blocked, so a proxy
  is required ([Drive API](https://developers.google.com/workspace/drive/api/guides/file)).

### Opening natively
- **Electron:**
  - `shell.openExternal` for links, already used through
    `navigationDecision` (`apps/desktop/src/urls.ts:48`).
  - Downloads go into an app-managed cache, then `shell.openPath`.
  - `win.previewFile(path, displayName)` gives Quick Look on **macOS only**
    ([BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)).
  - The main process validates everything; the renderer only ever sends a
    resource id.
- **iOS:** `QLPreviewController` over a downloaded temp file;
  `SFSafariViewController` for links.
- **Android:** download into `cacheDir`, a `FileProvider` URI,
  `ACTION_VIEW` + `FLAG_GRANT_READ_URI_PERMISSION`; Custom Tabs for links.
- **Web:** links open in a new tab (`rel=noopener`). Downloads use a signed URL
  with `response-content-disposition: attachment; filename*=UTF-8''…`.

---

## 2. Audit: what exists today

**Data**
- `Resource` (`schema.prisma:1550`, `resources`) is a Drive file:
  - `fileType` is a display bucket;
  - `gcsPath` and `fileSize Int` (so ≤2 GB);
  - `uploadedBy` is a bare string with no FK;
  - `metadata{originalFilename,mimeType}`, `folderId`;
  - `conversationId` marks a channel-owned file;
  - index fields `sourcePath`/`indexState`.
- `ResourceFolder`, `ResourceComment` and `ResourceChange` hold folders and
  cell review.
- `MessageFile` (`message_files`) joins messages to channel files.
- `LinkPreview` (`link_previews`) is a **global** cache by URL, 7 days.
  `MessageLinkPreview` joins it to messages.
- A resource node links to its file only through JSON `metadata.fileId`.
  Link resources are nodes with `url`; there is no `Resource` row for them.

**Storage**
- `lib/gcs.ts` has two drivers, `gcs` and `local`, and two buckets, media and
  resources.
- Writes are single-shot (`resumable:false`).
- `getSignedUrl` is read-only, lasts 15 min, is cached in memory, and cannot set
  a disposition.
- Paths are minted in `lib/storage/objectPaths.ts`.

**Upload**
- `POST /api/resources/upload` (multipart, **25 MB, buffered**) →
  `service.ts#uploadResource`. The type comes from the extension.
- Images are **re-encoded to WebP at 2000px and the original discarded**.
  There are no thumbnails.
- `receiveFile` (`receive.ts:37`) sniffs png/jpg/gif/pdf/webp only.
- `request_upload` provides a 15-min token, `PUT /api/uploads/<t>` and the
  `/drop/<t>` page.

**Text**
- `lib/notes/sources/extract.ts` handles csv/md/txt/json, docx (mammoth) and
  xlsx (SheetJS), chunked into `context_source_chunks`.
- There is **no PDF extraction.** Channel files and images are never indexed.

**Reads**
- `GET /api/resources/<id>/raw` → `requireReadableResource`
  (`access.ts:11`: space member + channel member) → 302 to a signed URL.
- `docx-preview/route.ts` checks **space membership only**: a leak of
  channel-file docx to non-members.
- `ResourceFile.tsx` is a page viewer: an iframe for PDF, mammoth HTML for
  docx, SheetJS capped at 500 rows, `<img>`. No video, audio, text or code.

**Messages**
- `sendMessage` (`messageService.ts:75`) accepts `fileIds` only if the **sender
  uploaded them into this same channel** (`shared/messageFiles.ts:15`), so
  re-sharing is impossible.
- Link cards come from `void attachPreviewsToMessage(...)` after the response,
  with no queue, no retry and no realtime event when they land.
- An author can't remove a card.
- There are **no private channels**: any member lists and joins any channel.

**Context**
- `resources/` is a namespace row (`namespaces.ts:137`, feature `directory`).
- `resource` is folder-only (`resources/<slug>/index.md`); notes are made by
  `createEntity`/`linkFileNode`.
- Grants have subject types `space | alias | user` (`authz.ts:67`), loaded
  pre-scoped by `access.ts#contextAccessFor`.

**Actions**

| Action | Location | What it does |
|---|---|---|
| `list_drive` | `context.ts:917` | ids only; skips channel files |
| `list_files` / `read_file` | — | context sources |
| `upload_file` / `request_upload` | `drive.ts:89/167` | upload into the Drive |
| `set_image` | `drive.ts:200` | sets a node's image |
| `add_context` | — | `type: resource`, `url` (link node + unfurl) |
| `create_event` / `update_event` | — | `cover_resource_id` → `lib/events/cover.ts`, which copies bytes into the event's media and **404s on a channel file** |

- There is no share or post action.
- `runAction` logs nothing.
- Agents run actions as the brief's author (`agents/tools.ts:959`).

**Desktop:** Electron 43 loads the web app. The preload exposes no file APIs,
and there is no `will-download` handler.

**Mobile:** native Swift and Kotlin with no file preview. Message models carry
`attachmentUrl` only.

**Design system**
- `@visvine/ui` has `Modal`, `Tabs`, `Button`, `Skeleton`, `Avatar`,
  `ConfirmDialog`, `useToasts`, `SearchInput`, `Chip`, `EmptyState`. It has
  **no Menu, Popover, Tooltip or IconButton.**
- **`color.type.resource` already exists** (orange; `-fg`, `-wash`).
  Categorical `hue.*` is the documented palette for telling file types apart.
- Icons are house SVGs in `assets/icons`: `file-text`, `file-code-2`, `video`,
  `music`, `table`, `link-2`, `download`, `external-link`, `zoom-in/out`.
  Missing: `file`, `file-pdf`, `file-image`, `file-spreadsheet`,
  `presentation`, `file-archive`, `maximize-2`, `minimize-2`, `panel-right`,
  `more-horizontal`.
- Current `FileTypeIcon` is hand-inlined SVG (`resourceUi.tsx:67`).

### Keep / drop from the current build

| Keep | Why |
|---|---|
| `resources` table + `ResourceFolder`/`Comment`/`Change` | Extended, not replaced; cell review survives |
| `ssrfSafeFetch`, `parseHead`, head-only read, media short-circuit, "oEmbed `html` never stored" | Sound and tested |
| `/raw` gated redirect; "a signed URL is never stored" | Becomes the one byte door |
| `request_upload` token + drop page + `receiveFile` | The MCP's path for files it can only see |
| Node page Preview tab, `linkFileNode`, cover copy into event media | Entity model stays |
| `SpreadsheetViewer` (cell comments/changes) | Becomes the xlsx/csv renderer |

| Drop | Why |
|---|---|
| `message_files`, `message_link_previews` | → `resource_shares` (one join for both kinds) |
| Four-source in-memory library fold, 150 per source | → one indexed query over resources ⋈ shares |
| "Channel files make no node" | You asked for every resource as an entity; visibility now comes from grants, so no leak and no Grid noise (the Grid hides `resource` by default, see §4.6) |
| "Only files you dropped in this channel" | → any resource visible to the sender |
| Hotlinked og images | Re-hosted by us |
| Iframing arbitrary sites | Allowlist only |
| mammoth `docx-preview` route | Replaced client-side; it had the missing channel gate |
| WebP-re-encoding originals | Originals preserved; renditions are separate |
| `void` fire-and-forget unfurl | Durable jobs (§4.2) |
| Event images as a library source | A cover made from a resource shows on the resource as "Cover of *Launch*"; a cover uploaded directly is event art, not a resource |

---

## 3. Data model: one resource, many shares

### `resources` (extended; add-only migration, nothing renamed)
```
source          ResourceSource  upload | link        (backfill: upload)
kind            ResourceKind    image video audio pdf doc sheet slides text code archive link other
nodeId          String? @unique → nodes (SetNull)   (replaces JSON metadata.fileId; mirror kept one release)
state           ResourceState   uploading | ready | failed | deleted
deletedAt, deletedBy                                 (trash; purged after 30 days by the nightly)
createdBy       String? → users (SetNull)             (replaces bare uploadedBy; old column dropped later)
-- upload
gcsPath, mimeType, sizeBytes BigInt, contentHash (md5 from GCS, else computed),
width, height, durationMs, pageCount, scanState (pending|clean|blocked|skipped),
textState (none|pending|indexed|unsupported|failed)  (sourcePath stays)
-- link
url, canonicalUrl, provider (google-doc|google-sheet|google-slides|google-drive|figma|youtube|loom|vimeo|web),
unfurl Json {title, description, siteName, authorName, publishedAt, faviconPath, mediaType, imageLayout},
embedUrl, embedKind (iframe|video|none), previewPath (re-hosted image), fetchedAt, fetchState,
entitySource ('scrape' | 'connector:<name>'), external Json {owner, modifiedAt, size, mimeType}
@@unique([spaceId, canonicalUrl])     -- NULLs don't collide, so uploads are unaffected
@@index([spaceId, kind, createdAt desc]) @@index([spaceId, state])
```
`fileType`, `uploadedBy`, `conversationId` and `metadata.fileId` become unused
columns awaiting a drop migration (the AGENTS pattern).

### `resource_shares` (new)
```
id, resourceId → resources (Cascade), spaceId,
conversationId? → conversations (Cascade)   -- null = shared to the space itself (added in Resources, uploaded by MCP)
messageId?      → messages (Cascade)
sharedBy? → users (SetNull), agentName?, via (upload|message|link|action|agent),
createdAt
@@index([conversationId, createdAt desc]) @@index([resourceId]) @@index([spaceId, createdAt desc])
@@unique([messageId, resourceId])
```
- A channel's Files tab is `shares WHERE conversationId = ?`.
- The same Sheet posted five times is **one** resource (canonical-URL unique
  per space) with **five** shares.

### `resource_renditions` (new)
`resourceId`, `kind` (thumb 360 | preview 2048 | poster | page1), `gcsPath`,
`width`, `height`, `mimeType`. Cascade.

### `resource_jobs` (new; Phase 2)
`id`, `resourceId`, `kind` (rendition|extract|unfurl|refresh|scan), `state`,
`attempts`, `runAfter`, `lockedUntil`, `error`.

### `resource_access` (new; the agent/MCP access log)
- Columns: `resourceId`, `spaceId`, `userId?` (SetNull), `agentName?`,
  `runId?`, `via` (web|mcp|agent|api), `action`
  (read|download|upload|share|use|delete), `at`.
- Written for every mcp/agent/api access and for web downloads and deletes.
- Added to `deleteAccount` (`tests/delete-account.test.ts` enforces it).

### Private channels (Phase 1)
- `Conversation.visibility ChannelVisibility @default(PUBLIC)` (PUBLIC|PRIVATE).
- `listChannelsForSpace` hides a private channel from non-members.
- `joinChannel` refuses without an invite: members add members through
  `AddMembersModal`.
- `create_channel` takes `private`. A channel admin toggles it in the channel's
  details pane; making a channel public asks through `ConfirmDialog`.
- The channel's node note is restricted to the channel (below).
- Feed, messages and stream are already membership-gated. The mobile payloads
  gain `isPrivate` and a lock glyph.

### The resource as a context entity
- Every resource, whether upload or link and whatever its origin (UI, message,
  MCP), gets `resource:<slug>` and `resources/<slug>/index.md` through **one**
  function, `lib/resources/entity.ts#ensureResourceEntity`, built on
  `createEntity`/`linkFileNode`. The row records `nodeId`, so the path is
  deterministic and stable across renames of the file.
- Following "a type's structured facts are a row; its note is prose":
  - the frontmatter keeps `type/title/node/description/tags`;
  - kind, size, url, provider and shares are **rendered from the row** when read
    (`read_resource`), never written into the note;
  - the body is people's and agents' prose;
  - `[[mentions]]` and derived links work as for any entity.
- Extracted text is indexed at `resources/<slug>/<file name>` (the
  `sourcePath`), so the note's visibility covers it.

### Permissions: visibility is the union of shares
- **Pure rule** (`lib/resources/shared/visibility.ts`): a viewer sees a resource
  if they are a space admin or super-admin, **or** any share reaches them:
  - `conversationId = null` → active space member;
  - otherwise → a member of that channel.
  - A resource with zero shares is visible to its creator and admins only.
- **SQL form** for lists (`lib/resources/visibility.ts`): an `EXISTS` over
  shares ⋈ `conversation_members`, one indexed probe per row.
- **Context notes follow the same rule** through a new grant subject,
  **`channel`**:
  - `GrantSubjectType = 'space'|'alias'|'user'|'channel'`.
  - `contextAccessFor` adds the viewer's channel ids in the space
    (request-memoised, one query).
  - `syncResourceGrants(resourceId)` is the **one writer**:
    - a space share → the folder stays open;
    - channel-only shares → `resources/<slug>/` marked restricted, with a view
      grant per sharing channel.
  - Private channel notes use the same mechanism.
  - The pure checks don't change because the loader pre-scopes. Search, tree,
    backlinks and federation all inherit it.
- **Bytes:**
  - Every byte goes through `/api/resources/<id>/{raw,thumb,preview}`: re-check,
    then a 302 to a **5-min** signed URL (`Cache-Control: private, max-age=240`).
  - `?download=1` adds `response-content-disposition` with the original name.
  - Buckets stay private.
- **Agents and MCP:** `runAction` → `resolveTarget` → the same
  principal. An agent sees exactly what its run-as person sees (private
  channels included), under its token's scopes. Each access writes
  `resource_access` with `agentName`/`runId`.

---

## 4. Design

### 4.1 Ingestion: uploads (Phase 2)
Every entry uses one pipeline: composer, drag-drop onto a channel, the
Resources view, the Files tab, `upload_file` (url/base64/attachment) and
`request_upload`.
1. `POST /api/resources/uploads`
   - Body: `{spaceId, name, size, mime, conversationId?}`.
   - Gates: space writer, plus channel membership if a channel is given.
   - Refuses a blocked extension.
   - Creates a `Resource{state: uploading}` and a GCS **resumable session URI**
     (`createResumableUpload`, origin-bound), then returns `{id, uploadUrl,
     chunkSize}`.
   - The bytes go browser → GCS directly, so there's no Cloud Run 32 MiB body
     cap and no buffering. The `local` driver serves
     `PUT /api/resources/uploads/<id>` with `Content-Range`, storing into
     `.storage`.
2. The client (`features/resources/lib/upload.ts`):
   - 8 MiB chunks over XHR (progress events);
   - on failure it resumes by asking for the offset (`bytes */size` → 308);
   - the progress UI is a hairline bar in the composer tray and in the
     Resources toolbar.
3. `POST /api/resources/uploads/<id>/complete`:
   - stats the object;
   - sniffs the first 4 KB with **`file-type`** (new dependency, MIT) and must
     agree with an allowlisted family;
   - takes the content hash from GCS md5;
   - image dimensions via `sharp.metadata`;
   - `scanState = skipped` (no scanner configured) — the `ResourceScanner`
     interface is in place for ClamAV later;
   - `ensureResourceEntity`, then a share (space, or channel + message on send);
   - `syncResourceGrants`;
   - enqueues rendition/extract jobs, and runs the image thumbnail **inline**
     (<300 ms) so the grid never shows a blank.
- **Type policy** (`lib/resources/shared/uploadPolicy.ts`, pure):
  - Blocked: executables and scripts (`exe msi dmg pkg app bat cmd com scr ps1
    sh jar apk`).
  - `html/svg/xml` are stored but **never rendered as documents**: SVG only
    through `<img>`, HTML/XML as text.
  - Everything is served from the storage origin, never ours.
- **Size:** `RESOURCE_MAX_BYTES` default 2 GB for resumable uploads; the
  8 MB base64 and 25 MB URL limits on `upload_file` stay.
- **Renditions** (job; sharp; `.rotate()` then strip metadata):
  - image: `thumb` 360 and `preview` 2048 WebP. **The original is untouched.**
  - PDF: **unpdf 1.8** (MIT; pdfjs serverless) for page count, text, and page-1
    render → `page1` thumb (needs `@napi-rs/canvas`, which has musl prebuilds
    for our alpine image).
  - pptx: `docProps/thumbnail.jpeg` + slide XML text.
  - docx/xlsx: text only (existing extractors).
  - video: the uploader's browser grabs a poster frame (canvas) and uploads it
    as the `poster` rendition, so there's no ffmpeg on the server.
  - HEIC: sharp's prebuilt can't decode HEVC, so the grid shows an icon and the
    viewer offers download/open.
- **Text** feeds the existing source index (`indexSource`); PDF becomes a new
  `sourceTypes` kind.

### 4.2 Jobs: work happens in a request, never after one
The runtime throttles CPU after a response and scales to zero, so:
- Jobs are rows, claimed with a conditional `UPDATE … RETURNING`, the same
  pattern as the nightly clean.
- There are three drains:
  1. **Inline** with a budget, where a request is already paying (image thumb
     on complete; unfurl of a cached URL on send).
  2. **Pulled:** a client showing a pending card or thumb calls
     `POST /api/resources/jobs/pull {ids}`, which gates, runs, and returns
     within 6 s. Whoever is looking finishes the work.
  3. **The minute tick** as a backstop, in the agent tick beside
     `projections/drain`, so no new Scheduler job is needed.
- Retries back off (1m, 5m, 30m, 3h, then failed).
- `resource.updated` goes out on `/api/messages/stream` to the channels holding
  a share, so cards fill in live.

### 4.3 Ingestion: links (Phase 3)
- `sendMessage`/`editMessage` (in the transaction):
  1. `extractUrls` (≤5).
  2. `canonicalUrl()` (pure, provider-aware):
     - strips `utm_*`/`fbclid`/fragments except meaningful ones;
     - Google `…/d/<id>/edit#gid=…` → `…/d/<id>`;
     - `youtu.be/x` → `youtube.com/watch?v=x`.
  3. Upsert the `Resource{source: link}` for `(space, canonicalUrl)`.
  4. Create the share on the message.
  5. Enqueue an unfurl if the resource is new or stale (>7 d).
  6. The message renders its card from the resource at once: a skeleton while
     `fetchState = pending`, then pulled.
- **Unfurl job:**
  - `ssrfSafeFetch` with DNS check on every hop, ≤4 redirects, 5 s, and head-only
    ≤256 KB; oEmbed ≤64 KB.
  - Precedence: **connector entity** → oEmbed → JSON-LD → OG → Twitter →
    `<title>`.
  - The preview image is fetched through `fetchPublicBytes` (≤5 MB, must sniff
    as an image), then sharp → `previewPath` (1200 w) + `thumb`, under
    `resources/<space>/<resourceId>/`. The favicon is re-hosted the same way.
  - The embed URL comes from the provider table.
  - The global `link_previews` table stays as the HTTP-level cache (text only,
    no bytes), so two spaces don't both re-fetch a URL.
- **Remove preview** (author or channel admin):
  - `DELETE /api/messages/<id>/shares/<resourceId>` removes **that share**.
  - The link text stays.
  - If it was the last share and the resource was born from a message and
    never added to the space, the resource goes to trash. Otherwise it lives on.
- Editing reconciles shares the way `attachPreviewsToMessage` does today.
  Deleting a message cascades its shares, with the same last-share rule.
- **Refresh:** opening a link resource whose `fetchedAt` is older than 7 d
  enqueues a `refresh`. The nightly refreshes links viewed in the last 30 d.

### 4.4 Agent / MCP surface (Phase 6)
Existing actions are extended rather than duplicated. Scopes live in the defs.

| Action | Change | Scope |
|---|---|---|
| `list_resources` | **`list_drive` renamed**, old name kept as a registry alias.<br>Filters: `kind` (image, pdf, doc, sheet, slides, video, audio, text, code, link…), `source`, `channel_id`, `shared_by`, `q` (name + extracted text + unfurl text, via `searchContext` restricted to `resources/`), `since`/`until`, `limit`, `cursor`.<br>Returns `resource_id`, name, kind, mime, size, dims, provider/url, `shares[{channel, message_href, at, by}]`, `node_id`, `note_path`, `has_thumbnail` — never a signed URL. Every row is stamped with `space`; omitting `space_id` searches everywhere, like `search_context`. | `context:read` |
| `read_resource` | **new** (`read_file` stays for context sources). Returns row facts + note + extracted text page (`offset_chars`/`max_chars`) + link unfurl/`external`. Images add dims and a caption from the note. | `context:read` |
| `upload_file` | Gains `channel_id` + `message`: lands in Resources **and** context (entity), optionally shared into a channel. | `context:write` (+ `messages:write` with a channel) |
| `add_context type:resource url` | Routed through `addLinkResource`, so it creates a `Resource{source:link}` + space share + unfurl. No new action. | `context:write` |
| `share_resource` | **new.** `resource_id`, `channel_id`, `text?` → posts a message as the caller carrying the share; the caller must see the resource and be in the channel. | **`messages:write`** (new scope; `SCOPE_DESCRIPTIONS` spells it out) |
| `set_image`, `create_event`/`update_event cover_resource_id` | Gate becomes `canSeeResource` rather than "not a channel file"; records a `use` access and `usedAs` on the resource ("Cover of *Launch*"). | unchanged |
| `request_upload` | Unchanged; its uploads go through `complete`. | unchanged |
| `search_context` | Resource hits carry `resource_id` + `read_with: read_resource`. | unchanged |

- `db:actions:sync` renders the manuals. The `writing_notes` guide gains
  "a resource's note is prose about the file".
- **Acceptance test** (`tests/resources-event-logo.test.ts`, DB-guarded like
  `agents-tick.test.ts`):
  1. Seed a space; Ana is in a **private** `#brand`; `logo.png` is shared there.
  2. `runAction('list_resources', {kind:'image', q:'logo'})` as Ana → the id.
  3. `runAction('create_event', {title:'Launch', cover_resource_id})` → the
     event node's `imageUrl` sits under `mediaPrefixBare('event', id)` with
     variants.
  4. `resource_access` has a `use` row with `via:'mcp'`.
  5. As Ben (space member, not in `#brand`): the list omits it, and
     `create_event` with that id → 404.
  6. As an agent whose brief runs as Ana: same as step 2 with `via:'agent'` and
     `agentName`.

### 4.5 Viewer (Phase 4)
**Modes**
- A **side panel** (flexpane, 440 px):
  - in Messages it reuses the right-pane slot `ThreadPanel`/`ProfilePanel`
    use;
  - elsewhere it floats at the right with `shadow-float`.
- **Full screen** (Modal, `size` full, portalled).
- The state is in the URL (`?resource=<id>[&full=1]`), so Back closes it and a
  link opens it.

**Chrome** (`@visvine/ui` `ResourceViewer`)
- Header: `Avatar` · name, then one muted line: `Ana · in #brand · 3 d · PDF ·
  2.1 MB`.
- Stage `bg-surface-muted`; the document floats on it (`shadow-float`).
- Prev/next edge buttons. PDFs get a page rail at ≥ lg (as in your screenshot).
- Action bar at the top right:
  - primary: **Open in {Provider}** / **Open in browser** (links), **Download**
    (uploads);
  - then **Share**, **Copy link**, and overflow `Menu` (**View in context**,
    **Open in app** on desktop, **Delete**).

**Keys:** ←/→ between the list the viewer was opened from; Esc steps full →
panel → closed; `+`/`-`/`0` zoom; `f` toggles full. Focus is trapped and
returned.

**Zoom/pan** (`ZoomPane`): Mattermost's settings and cursor-aware wheel/pinch,
with drag-to-pan only when zoomed.

**States:** a shaped `Skeleton` per renderer; `ViewerError` (retry + download);
`ViewerFallback` for unsupported (large `FileTypeIcon`, name, `size · type`,
Open/Download). The fallback is a designed screen, not an apology.

**Registry** (`features/resources/viewer/registry.ts`, pure map kind → lazy
renderer; tested):
- image (original `src`), video/audio, pdf (react-pdf, text layer, find),
  docx (docx-preview), sheet (SheetJS, sheet tabs, virtualised, comments kept),
  slides (thumbnail + outline), markdown, code/text (≤1 MB);
- link-embed: allowlisted iframe with `sandbox="allow-scripts allow-same-origin
  allow-popups allow-forms allow-presentation"`, `referrerpolicy=no-referrer`,
  a CSP `frame-src` list from the same provider table, an 8 s load timeout, and
  a connector 403 → card;
- link-card (`UnfurlCard` large + primary Open), unsupported.

**Downloads always deliver the original:** `raw?download=1`.

### 4.6 Views (Phase 5)
**One `ResourcesBrowser`**, scoped by props: `{space}` or `{space, channel}`.
- **Space:** Directory → Resources (`?view=resources`, which exists).
- **Channel:** a new **Files** tab in the channel header (`ThreadPanel`), as
  `Tabs` Messages · Files, gated by the channel's own membership.

**Toolbar:** `SearchInput`; type chips `All · Images · PDFs · Docs · Sheets ·
Slides · Video · Audio · Links`; `Mine`; Channel / Person / Date filter menus;
sort `Recent · Name · Size`; grid/list toggle. The view is kept per viewer in
`localStorage`, like `useTableView`.

**List** (your Slack screenshot, flattened to our rules):
- hairline rows; a 36 px `FileTypeIcon` tile or thumb;
- name; one muted line `Ana · #brand · 3 d`;
- hover actions: Download / Open, Share, overflow.

**Grid:** a 4:3 thumb tile, name and meta. **Images filter = image-first
grid**: square tiles with no text until hover. This is the fast path to "pick
the logo".

**Bulk select:** a checkbox on hover; shift-range; a floating bar with Share,
Download and Delete.

**Trash:** a filter row visible to admins and creators; restore / delete
forever.

**Data:** `GET /api/spaces/<id>/resources?kind&channel&by&q&since&sort&cursor`
- one SQL query with the visibility `EXISTS`, keyset-paged;
- `q` uses `searchContext` over `resources/` + name `ILIKE`;
- read through `swrFetch` with key `resources:<space>:<channel>:<filters>`;
- upload, share, delete and send invalidate the key.

**Directory Grid** hides `type: resource` unless that type is selected, so
channel files don't flood it.

**Messages**
- Image shares render in `MessageImageGrid` (now opening the viewer); files as
  `ResourceRow` compact; links as `UnfurlCard` (with an embed thumb for video
  providers).
- The composer attaches any file (resumable) and **Share existing** (picker
  over `list_resources`).

### 4.7 Native open (Phase 7)
**Desktop**
- The preload adds `visvineDesktop.files.{open(id), quickLook(id)}`.
- Main process:
  - validates a UUID;
  - downloads `raw?download=1` using the window's own session into
    `userData/resource-cache/<id>/<sanitised name>` (resolved path asserted
    inside the cache; LRU 1 GB; cleared on sign-out);
  - then `shell.openPath` or `win.previewFile` (macOS; others fall back to
    openPath).
- Links reuse `navigationDecision` → `openExternal` (http/https only).
- A `will-download` handler saves into Downloads.
- The web shows **Open in app** only when `isDesktop`.

**Mobile:** `docs/resources/mobile.md` specs the endpoints, the `shares[]`
message payload, and `FileTypeIcon`/`ResourceRow`/`UnfurlCard`/viewer screens:
- iOS: QuickLook + SFSafariViewController;
- Android: FileProvider (`${applicationId}.resources`) + `ACTION_VIEW` + Custom
  Tabs.

Implementation of the native clients follows in a later project.

---

## 5. Design system alignment
- **Light only.** Paint with role utilities (`bg-surface`, `bg-surface-muted`,
  `text-fg-muted`, `border-line-subtle`, `bg-accent`). Floats get
  `shadow-float`, nothing else does. `tests/design-tokens.test.ts` stays green.
- **Resource type colour already exists** (`color.type.resource`, orange). No
  new type token.
- **File kinds are told apart with `hue.*`**, per DESIGN.md:55, through a
  token-level map `color.file.<kind>` → `hue.*` in `semantic/base.json`, so
  native reads the same map:
  - pdf red, doc blue, sheet green, slides amber, image violet, video pink,
    audio indigo, code/text gray, archive yellow, link sky.
  - `pnpm tokens:build` regenerates all four platforms.
- **Icons** are added to `assets/icons` with `ATTRIBUTION.md` rows:
  - Lucide-derived: `file`, `file-image`, `file-spreadsheet`,
    `presentation`, `file-archive`, `maximize-2`, `minimize-2`,
    `panel-right`, `more-horizontal`, `copy`, `share`, `grid`, `list`.
  - House-drawn: `file-pdf` (1.8 stroke).
  - Run `pnpm icons:build`; the ones `@visvine/ui` draws go in `UI_GLYPHS`;
    run the native icon scripts.
- **New in `@visvine/ui`** (framework-free, no heavy deps; images come through
  `UIProvider`): `FileTypeIcon`, `ResourceRow`, `ResourceCard`, `ResourceGrid`,
  `UnfurlCard` (moved from `features/shared/components/LinkPreviewCard`),
  `ResourceViewer` (chrome + slots), `ZoomPane`, `ViewerFallback`, `Menu` (the
  missing overflow primitive, needed by the action bar), `IconButton`.
  - Each gets a DESIGN.md table row and a `.design-sync/artifact/components.json`
    entry (so it syncs to Claude Design), plus a **Viewer** subsection under
    *Mirroring a component natively*.
  - The heavy renderers stay in `apps/web/features/resources/viewer/`.

---

## 6. Delivery: phases (each a reviewable commit set with tests)

| # | Scope | Key files | Tests |
|---|---|---|---|
| 1 | Schema: resources columns, `resource_shares`, `resource_renditions`, `resource_access`, `Conversation.visibility`, `channel` grant subject; backfill script `db:resources:reshape` (MessageFile/MessageLinkPreview/link nodes → Resources + shares; every resource gets its entity; grants synced); visibility pure + SQL; private channels in list/join/create/toggle; `/raw` + docx gate fixed; `TABLES.md`, `deleteAccount` | `prisma/schema.prisma`, `lib/resources/{visibility,entity,grants}.ts`, `lib/notes/access.ts`, `lib/notes/shared/authz.ts`, `lib/messages/conversationService.ts`, `lib/actions/defs/channels.ts` | `resource-visibility`, `private-channels`, `channel-grants`, `delete-account`, backfill dry-run on the seed |
| 2 | Resumable upload (init/chunk/complete), upload policy, `file-type`, renditions + jobs table + pull/tick drains, unpdf text + page-1 thumb, `thumb`/`preview` routes, originals preserved | `app/api/resources/uploads/**`, `lib/resources/{upload,renditions,jobs}.ts`, `lib/gcs.ts` (resumable + disposition), `features/resources/lib/upload.ts` | `upload-policy`, `renditions` (EXIF gone from rendition, original byte-equal), `resource-jobs` (claim race), local-driver resume |
| 3 | `canonicalUrl` + provider table, JSON-LD in `parseHead`, unfurl job with re-hosting + connector entity, message → share ingestion, remove-preview, `resource.updated` broadcast | `lib/links/shared/{unfurl,canonical,providers}.ts`, `lib/resources/unfurl.ts`, `lib/messages/messageService.ts` | `link-unfurl` (+JSON-LD), `canonical-url`, **`ssrf-fetch`** (127/8, 10/8, 169.254.169.254, `::ffff:127.0.0.1`, decimal/octal IPs, redirect-to-private on hop 2, >4 hops, body cap, timeout, non-http scheme), `resource-shares` (dedupe, last-share rule) |
| 4 | Icons, `color.file.*` tokens, `@visvine/ui` components, viewer registry + renderers, side/full modes, keys, zoom | `assets/icons/*`, `packages/tokens/tokens/semantic/base.json`, `packages/ui/src/{resources,Menu,IconButton}*`, `features/resources/viewer/**`, `lib/security/csp.ts` | `viewer-registry`, `zoom-math` (pure), `design-tokens`, `icons`, contrast check |
| 5 | `ResourcesBrowser` (space + channel Files tab), filters, grid/list, image-first grid, bulk, trash, composer attach + Share existing, message rendering | `features/resources/components/**`, `features/messages/components/{ThreadPanel,MessageRow,MessageComposer}.tsx`, `app/api/spaces/[spaceId]/resources/route.ts` | `resource-list-query` (filters + keyset), `directory-views`; manual run with the `run` skill |
| 6 | `list_resources` (+alias), `read_resource`, `share_resource`, `messages:write`, extended `upload_file`/`add_context`/cover gates, access logging, `db:actions:sync` | `lib/actions/defs/{drive,context,resources}.ts`, `lib/mcp/scopes.ts`, `lib/events/cover.ts` | `resource-actions`, **`resources-event-logo`** acceptance |
| 7 | Desktop open / Quick Look / downloads; `docs/resources/mobile.md`; docs + AGENTS.md sections (Directory, Creating things, Mobile) | `apps/desktop/src/{preload,main,files}.ts` | `apps/desktop` unit test for path/ID validation; manual Quick Look on macOS |

## Verification (every phase)
- `pnpm typecheck`, `pnpm lint` (`--max-warnings=0`), `pnpm test`,
  `pnpm --filter @visvine/web knip`; `pnpm tokens:check` and `icons:check`
  where touched.
- A migration's SQL is read before commit (no drop+create).
- Live check against `pnpm dev` + local storage:
  - upload a 300 MB video (kill the tab mid-upload, resume);
  - PDF / docx / xlsx / pptx / HEIC;
  - post a Google Sheet, YouTube and news link twice in two channels → one
    resource, two shares, cards live;
  - private channel as a second user → absent everywhere (list, search,
    `/raw`, note);
  - `pnpm mcp:dev` runs the event-logo flow for real.
- Each phase's report says what was verified and what wasn't, e.g. Quick Look
  and Windows `openPath`, GCS resumable CORS (only real on a deployed bucket),
  and Google embeds in Safari.

## Risks / notes
- **GCS bucket CORS** must allow `PUT` from the app origins for resumable
  sessions. This is a one-time `gsutil cors set`, recorded in `docs/runbook.md`,
  and a deploy step you run.
- `unpdf`/`@napi-rs/canvas` on alpine: if the canvas prebuild fails in the
  image, PDF thumbnails fall back to the icon and text extraction still works.
- The Phase 1 backfill writes notes; it runs locally via `pnpm db:...` and in
  production through `with-prod-env` when you choose.
