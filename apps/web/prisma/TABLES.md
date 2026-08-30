# What each table controls

Plain-English map of `schema.prisma`. Postgres table name in `code`.

**Naming rule:** a table is prefixed with the tool that owns it — `context_*`,
`connector_*`, `event_*`, `resource_*`, `message_*`. Only genuinely cross-tool
things go unprefixed (`spaces`, `users`, `people`, `identities`, `nodes`,
`links`, `oauth_*`).

## The tenant

| Table | Controls |
| --- | --- |
| `spaces` | A Space — the tenant. Name, emoji, image, location, tags, public/private, invite token, and its **vocabulary**: which node types, aliases, and link types exist (stored as JSON). `personal_owner_id` set = it's a hidden one-person Space holding that user's personal notes. |
| `space_members` | Who belongs to a Space, and whether they're `active` or `pending` (asked to join via invite link). Carries **no role** — permissions come from aliases. |
| `space_invitations` | An admin asking someone to join, and their answer (`pending` / `accepted` / `declined`). Grants nothing on its own — accepting is what writes the `space_members` row and the `user_aliases` staged in `alias_ids`. Kept out of `space_members` on purpose: most membership checks read whether the row exists, not its status. |
| `user_aliases` | Which aliases a member holds ("Admin", "Investor", …). This *is* the permission model: holding an alias marked `admin` = admin of that Space. Keyed by `user_id`, so it applies to a login account, not to a directory card. |

## Context

The notes surface. Every row is keyed `(space_id, owner_key)` — `owner_key =
'shared'` is the Space's context that members see. (Personal context now lives
in the shared context of a personal Space, so any other value is legacy.)

| Table | Controls |
| --- | --- |
| `context_notes` | The notes themselves. Full markdown (frontmatter + body) is the source of truth. Soft-delete (`deleted_at`) = trash. |
| `context_note_revisions` | Version history. One full snapshot per save, plus who saved it and why (`edit`, `agent`, `ai-enrich`, `restore`, …). |
| `context_folders` | Folders that exist even when empty, plus the two folder flags: `restricted` (cuts permission inheritance at that boundary) and `locked` (frozen for AI). |
| `context_state` | Control-plane sidecar files — folder registry, read-audit log, join requests, enrichment ledger. JSON/JSONL blobs, one row per named file. |
| `context_note_embeddings` | Cached vector for each whole note, for semantic search. Re-computed when the note changes. |
| `context_memories` | One-sentence claims extracted from each note by the nightly sweep, with a vector each. Search ranks over them and folds each hit onto its note, so a result can carry the sentence that answered. Rows from an older save of the note are never served. |
| `context_publications` | A live publish link: a note in one Space is mirrored into another Space's context and rewritten on every save. Turning it off leaves the copy behind as a plain note. |
| `context_sources` | A non-note file attached to the context (CSV, markdown, text). Original lives in GCS; this row is the metadata + extraction status. Never appears as a Node or in the Directory. |
| `context_source_chunks` | The extracted text, split into chunks, each with a vector. This is what source-level search actually reads. |

### Context permissions

| Table | Controls |
| --- | --- |
| `context_grants` | One rule: *subject* (whole Space / an alias / a single user) gets *level* (view 10, comment 20, edit 30, full 40) on *path* (root, a folder, or one note). Access flows down the tree; your effective level is the highest grant that reaches the note. Grants only ever add. |
| `context_access_requests` | "Please give me access to X" — the request, its status, and what an admin eventually granted. Kept afterwards as the audit trail. |

## Connectors

| Table | Controls |
| --- | --- |
| `connector_secrets` | Named, encrypted secrets a connector note refers to as `{{secret:NAME}}`. Only decrypted server-side while a connector runs — the API lists names, never values. The connector itself is a note, so it lives in `context_notes`. |

## The graph (Directory, Events, Context entities)

Not prefixed on purpose: these three tables back the Directory, Events, *and*
the entity notes in Context. They're the shared graph primitives.

| Table | Controls |
| --- | --- |
| `nodes` | Every entity in a Space — a person, org, event, etc. Type, name, subtitle, image, tags, free-form metadata, and the display-only alias chip. Belongs to exactly one Space. |
| `links` | Edges between two nodes: relationship name, provenance (`manual`, `event_attendance`, `context`, …) so auto-created links can be auto-removed, and a `pair_key` so A→B and B→A dedup to one edge. |

## Events

| Table | Controls |
| --- | --- |
| `event_attendees` | RSVPs for an Event node. Guest details (works without a login or Person node), status (`going`, `waitlisted`, `checked_in`, `no_show`, …), separate response intent, plus-ones, check-in time. |

## People & identity

| Table | Controls |
| --- | --- |
| `users` | Login accounts — email, password hash / Google id, verification, active flag. |
| `people` | Profile detail for a person: bio, links, phone, pronouns, photo, tags. Optionally attached to a `users` row. |
| `identities` | The canonical cross-Space identity of one real person or org. Many Space-private `nodes` can point at the same identity; only identity-level facts (canonical name, photo, email, LinkedIn, domain) live here — Spaces never share their per-node data. |
| `identity_resolutions` | Log of every "these two are/aren't the same person" decision, with confidence and reason. Also records rejections so the matcher stops re-suggesting them. |

## Resources

| Table | Controls |
| --- | --- |
| `resources` | An uploaded file in a Space — name, type, object path, size, uploader, and the folder it sits in. |
| `resource_folders` | A folder in a Space's Drive — name and parent. Organisational only; files index and search the same anywhere. |
| `resource_comments` | Comments on a resource, optionally pinned to a specific cell. |
| `resource_changes` | Proposed edits to a specific cell, with an approve/reject workflow (who proposed, who reviewed). |

## MCP / OAuth (agents connecting in)

| Table | Controls |
| --- | --- |
| `oauth_clients` | Registered MCP/OAuth apps, and the redirect URLs each is allowed to use. |
| `oauth_auth_codes` | Short-lived, single-use login codes during the OAuth handshake (PKCE). |

## Messages

| Table | Controls |
| --- | --- |
| `conversations` | A DM, group, or Space channel. For channels: name, emoji, which section it sits in, and whether it renders as chat or a social feed. |
| `channel_sections` | Named groups of channels in the sidebar rail, with ordering. Deleting one just unfiles its channels. |
| `conversation_members` | Who's in a conversation, their role, last-read timestamp (unread counts), and mute-until. |
| `messages` | The message text, attachment, reply-parent, edit/delete timestamps, pin state. |
| `message_images` | Ordered images attached to a message. |
| `message_mentions` | @-mentions in a message — of a user or of a directory node. |
| `message_reactions` | Emoji reactions; one per (message, user, emoji). |
| `message_stars` | Per-user saved/bookmarked messages. |
| `link_previews` | Cached preview card (title, description, image) per URL, shared across messages. |
| `message_link_previews` | Joins a message to the preview cards it shows. |

## Two things that look like duplicates but aren't

**`user_aliases` vs `nodes.alias`.** The row is the permission: it keys a login
account and is what `isAdmin` and `context_grants` read. The column is the
coloured chip on a directory card — Space-local, hand-editable, and present on
nodes that have no login behind them at all. A new member gets the column
stamped once from their alias, and it's free to drift after that. Permissions
never read it, because a node has no account and note frontmatter is
user-editable prose.

**`context_notes` vs `context_sources`.** Notes are markdown the app owns and
parses (frontmatter, links, index rules). Sources are uploaded files it only
extracts text from. Same key, same folder gate, disjoint namespace — a source
path may not end in `.md`.
