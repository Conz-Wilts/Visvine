# Resources

The Directory's Resources tab (`/directory?view=resources`) is every
unstructured thing a space holds — files and links — in one list, the way
Slack's Files browser holds every file shared anywhere.

## Where things come from

| Source | Kind | Stored as | Opens |
|---|---|---|---|
| Uploaded in the tab, by an AI (`upload_file`) | file | `Resource` + its `resource:` node | the node page (Preview is the file) |
| Link pasted in the tab, or `add_context` with a `url` | link | `resource` node with `url` | the node page |
| File dropped into a channel or feed post | file | `Resource` with `conversationId`, via `message_files` | `/resources/<id>` |
| Link in a channel message | link | `link_previews` ⋈ `message_link_previews` | the URL |
| Event cover | file | event node `imageUrl` | the event |

A file dropped into a channel makes no directory node: a directory of chat
screenshots is noise. It is still one `Resource`, as Slack keeps one File a
message references, so it is searchable and listed here.

`lib/resources/library.ts` reads the sources; `lib/resources/shared/library.ts`
folds them (pure, `tests/resource-library.test.ts`). A link shared many times
is one row carrying its share count; a link someone added as a resource wins
that row and keeps its own name and page.

## Who sees what

The route is gated like the Directory (active member, `directory` tool). On top
of that, a channel's files and links appear only to that channel's members, and
only while Channels is a tool they can open — the feed's rule. A DM belongs to
no space; its composer takes no files.

`GET /api/resources/<id>/raw` serves a file's bytes: it re-checks the reader
(space member, and channel member for a channel's file) and redirects to a
freshly signed URL. A signed URL is never stored or put in a message.

## Link previews

`lib/linkPreview.ts` fetches, `lib/links/shared/unfurl.ts` parses (pure,
`tests/link-unfurl.test.ts`). The order is Slack's:

1. A URL whose content type is media (image, video, audio, PDF) previews as
   itself; no HTML is read.
2. The page's oEmbed endpoint, when its head names one: title, author,
   provider, thumbnail. Its `html` is never stored or drawn.
3. Open Graph, then Twitter card tags, then `<title>` and meta description.
   `twitter:card=summary` draws a small square thumb; otherwise the image is
   wide.

Only the head is read (up to `</head>` or 256 kB). Every hop is SSRF-checked.
Previews are cached per URL for 7 days in `link_previews`. A message's cards
follow its text: an edit drops a removed link's card and unfurls a new one.

Preview images are hotlinked from the source site (the CSP allows `https:`
images). Slack re-hosts them; doing the same is the next step if a site's
images must not see the viewer's request.
