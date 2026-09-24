# Resources on the phone

The spec the native clients (`apps/mobile/ios`, `apps/mobile/android`) build
the resources surface to. The server half is done; the screens are a later
project. Everything here is a route the web already uses, called with
`Authorization: Bearer <jwt>` (`docs/mobile.md`), camelCase in and out.

The phone **views, opens and shares**. It does not upload in this pass: a file
for a space is asked of an AI (`upload_file`, `request_upload`) or dropped in on
the web, per "Nothing in the apps creates anything" in `AGENTS.md`.

## What a message carries

A channel message (`SerializedMessage`, `lib/messages/types.ts`) carries its
resources in two arrays, both already filtered to what the reader may see:

| Field | One entry | Draw |
|---|---|---|
| `files[]` | `{ id, name, fileType, kind, fileSize, width, height, url }` — `url` is the gated `/api/resources/<id>/raw` | images (`kind: image`) as a grid of `thumb`s; everything else as a **ResourceRow** |
| `linkPreviews[]` | `{ url, title, description, imageUrl, siteName, faviconUrl, imageLayout, resourceId, provider, embedUrl, pending }` | an **UnfurlCard**; `pending: true` draws the skeleton and pulls (below) |

A DM carries `linkPreviews` without `resourceId` (text-only cards; a DM
belongs to no space) and no `files`.

The stream (`/api/messages/stream`) sends `resource.updated` with
`{ conversationId, card }` to every channel holding a share when an unfurl
lands: replace the card whose `resourceId` matches `card.resourceId`.

Channels carry `visibility: 'PUBLIC' | 'PRIVATE'`. A private channel draws a
lock glyph (`lock`) beside its name, and is listed only to its members.

## The routes

| Route | Answers |
|---|---|
| `GET /api/spaces/<id>/resources?kind=&channel=&by=&q=&since=&sort=&offset=&limit=` | `{ items: ResourceView[], nextOffset }` — the space's Resources, or a channel's Files with `channel=` (`lib/resources/shared/listQuery.ts` is the query) |
| `GET /api/resources/<id>/view` | one `ResourceView` (`lib/resources/shared/view.ts`): kind, size, dimensions, pages, creator, shares, card, and every image URL below |
| `GET /api/resources/<id>/thumb?kind=thumb\|preview\|poster\|page1\|favicon` | 302 to a short-lived signed rendition. `thumb` is 360 px, `preview` 2048 px, both WebP |
| `GET /api/resources/<id>/raw` | 302 to the ORIGINAL bytes; `?download=1` adds `Content-Disposition` with the file's own name |
| `GET /api/resources/<id>/text?offset=&max=` | a page of the text extracted from a PDF, deck or document |
| `POST /api/resources/jobs/pull { ids }` | finishes owed work (an unfurl, a thumbnail) for resources the caller can see, within 6 s. Call it for a `pending` card or a missing thumb, then refetch |

Every one of them answers 404 for a resource the caller cannot see, the same as
for one that does not exist. Never cache a signed URL past its redirect: follow
the 302 each time.

## Screens

**FileTypeIcon.** The kind's glyph on its hue wash, from the shared icon set
(`file`, `file-image`, `file-play`, `file-music`, `file-pdf`, `file-text`,
`file-spreadsheet`, `presentation`, `file-code-2`, `file-archive`, `link-2`)
and the `color.file.<kind>` tokens (`pnpm tokens:build` emits both platforms).
The web map is `packages/ui/src/resources/fileKinds.tsx`; mirror it exactly.

**ResourceRow.** 36 pt tile (the thumb if there is one, else the icon), the
name, then one muted line: `Ana · #brand · 3 d`. A tap opens the viewer.

**UnfurlCard.** Site line (favicon · site name), title, description, and the
image: a small square beside the text for `imageLayout: 'summary'`, wide above
it otherwise. The image is `imageUrl`, already one of ours.

**Viewer.** A full-screen sheet over the list the tap came from; swipe between
its items.

| Kind | iOS | Android |
|---|---|---|
| image | zoomable image of `preview`, falling back to `raw` | same, `SubsamplingScaleImageView` or Compose zoom |
| pdf, doc, sheet, slides, text, code, archive, other | download `raw?download=1` to a temp file and hand it to `QLPreviewController` | download into `cacheDir/resources/<id>/<name>`, share it through a `FileProvider` (`${applicationId}.resources`) with `ACTION_VIEW` + `FLAG_GRANT_READ_URI_PERMISSION`; no app for the type → the share sheet |
| video, audio | `AVPlayerViewController` on `raw` (range requests work through the redirect) | `ExoPlayer` on `raw` |
| link | `SFSafariViewController` on `url` | Custom Tabs on `url` |

The file name on disk is the one from `Content-Disposition`, reduced to one
path segment (no separators, no leading dots) the way
`apps/desktop/src/resource-cache.ts#safeFileName` does; the folder is keyed by
the resource id, which is always a UUID — refuse anything else before building
a path. Clear the cache on sign-out.

The header is the name and one muted line (`Ana · in #brand · 3 d · PDF ·
2.1 MB`); the actions are **Open in…** (the system share sheet with the
downloaded file, or the URL for a link) and **View in channel** when a share
has a `messageId` (`/channels/<id>?message=<messageId>` in the app's own
router).
