# Visvine MCP — Tool Inventory & Drip-Feed Plan

> **Why this doc exists.** The MCP server (`apps/web/lib/mcp/`) was exposing **72 tools**
> across 11 domain modules — too many for clients to reason about at once. We've temporarily
> reduced the live surface to **the event tools only**. This document is the canonical record
> of every tool that exists in the codebase so we can **drip-feed the others back in**, one
> module at a time, by re-enabling its `register*Tools(server)` call in
> `apps/web/lib/mcp/tools/index.ts`.
>
> The tool *code* has NOT been deleted — every `tools/<module>.ts` file is still present.
> Only the registration calls in `index.ts` are commented out. Re-enabling a module is a
> one-line change.

## Current state

- **Live now:** `events` module only (9 tools).
- **Parked (code intact, registration disabled):** the other 10 modules (63 tools).

To bring a module back: open `apps/web/lib/mcp/tools/index.ts`, uncomment its import + its
`register*Tools(server)` line, and (if relevant) confirm its scope is still advertised in
`apps/web/lib/mcp/scopes.ts` and documented in `docs/MCP.md`.

Each tool below lists its **scope** (the OAuth scope the token must carry) and a one-line summary.

---

## ✅ LIVE — `events` (9 tools) · `apps/web/lib/mcp/tools/events.ts`

| Tool | Scope | Summary |
|---|---|---|
| `list_events` | `events:read` | List published events for a community you belong to, with attendance stats. |
| `get_event` | `events:read` | Get one event with stats; `include_attendees=true` adds the guest list (host/admin). |
| `create_event` | `events:write` | Create an event (you become a host); defaults to published + community-visible. |
| `update_event` | `events:write` | Update event details (only passed fields change); host or community admin. |
| `list_attendees` | `events:manage` | List an event's attendees/guest list (PII); host or community admin. |
| `update_attendee` | `events:manage` | Change one attendee's status (approve/promote/waitlist/checkin/uncheckin/no_show/decline). |
| `bulk_update_attendees` | `events:manage` | Apply a status action to many attendees by id list or status scope. |
| `export_attendees_csv` | `events:manage` | Export an event's attendee list as CSV text; host/admin. |
| `get_event_ics` | `events:read` | Get an event as an iCalendar (.ics) document. |

---

## ⏸ PARKED MODULES (drip-feed these back)

Listed roughly in suggested re-introduction order (identity first — it's the discovery root
every other community-scoped tool depends on).

### 1. `identity` (3 tools) · `tools/identity.ts`

The discovery root: who am I, what communities/roles do I have. **Re-enable this first** —
nearly every other tool needs a `community_id` the user can only get from here.

| Tool | Scope | Summary |
|---|---|---|
| `whoami` | `communities:read` | Identity of the authed user (userId, email, name, personId) + granted scopes. |
| `list_my_communities` | `communities:read` | Every community the user belongs to, with role (admin/member). |
| `get_community` | `communities:read` | One community's summary (name, role, node types, design config); member only. |

### 2. `profile` (2 tools) · `tools/profile.ts`

| Tool | Scope | Summary |
|---|---|---|
| `get_profile` | `profile:read` | Get a person's full profile by person node id. |
| `update_my_profile` | `profile:write` | Update your own profile (only passed fields change). |

### 3. `directory` (12 tools) · `tools/directory.ts`

Graph / nodes / companies / search. Companies are `Node`s of type `organization`.

| Tool | Scope | Summary |
|---|---|---|
| `list_directory` | `directory:read` | List directory nodes (people/orgs/events/groups) for a community; optional type filter. |
| `list_organizations` | `directory:read` | List organization/company nodes for a community. |
| `get_graph` | `directory:read` | Full relationship graph (nodes + links) for a community. |
| `get_node` | `directory:read` | One node with its connections + connection count. |
| `search_nodes` | `directory:read` | Fuzzy keyword search for nodes by name/email across your communities. |
| `search_people_semantic` | `directory:read` | Natural-language semantic + keyword search over a community's directory. |
| `create_node` | `directory:write` | Create a directory node; admin role required. |
| `update_node` | `directory:write` | Update fields on an existing node; admin role required. |
| `create_link` | `directory:write` | Create a directed relationship between two nodes; admin role. |
| `update_link` | `directory:write` | Update an existing link's relationship/since/metadata; admin role. |
| `get_embedding_status` | `directory:read` | How many nodes have semantic-search embeddings vs not. |
| `backfill_embeddings` | `directory:write` | Generate embeddings for nodes lacking them (costs OpenAI calls); super-admin. |

### 4. `crm` (25 tools) · `tools/crm.ts`

The biggest module — member directory (admin), shared community columns/values, per-user
private columns/values, column + value-share request workflows, settings, import, audit.
Consider splitting this into sub-batches when re-introducing (e.g. read tools first, then
write tools, then the request/review workflow).

| Tool | Scope | Summary |
|---|---|---|
| `list_members` | `crm:read` | List a community's members with CRM data (paginated/searchable); admin. |
| `get_member` | `crm:read` | One member's full CRM record; admin. |
| `export_members_csv` | `crm:read` | Export the full member list (with custom fields) as CSV; admin. |
| `create_shadow_member` | `crm:write` | Add a member by email (creates shadow user if needed); admin. |
| `update_member_field` | `crm:write` | Set one private CRM field on a member; admin. |
| `bulk_update_member_field` | `crm:write` | Set one private CRM field on many members at once; admin. |
| `update_member_role` | `crm:write` | Change a member's role (admin/member); last admin protected. |
| `import_members_csv` | `crm:write` | Bulk-import members from CSV (max 1000 rows); admin. |
| `get_crm_settings` | `crm:read` | Get a community's CRM field definitions (schema); admin. |
| `update_crm_settings` | `crm:write` | Replace a community's CRM field definitions; admin. |
| `get_crm_audit` | `crm:read` | Get the CRM audit log; admin. |
| `list_community_columns` | `crm:read` | List shared CRM column definitions for a community; member. |
| `get_community_values` | `crm:read` | Get shared CRM column values for a set of nodes; member. |
| `set_community_value` | `crm:write` | Set a shared CRM column value on a node; member. |
| `request_community_column` | `crm:write` | Propose a new shared CRM column (admins review); member. |
| `list_column_requests` | `crm:read` | List CRM column requests (own, or all if admin). |
| `review_column_request` | `crm:write` | Approve/reject a CRM column request; admin. |
| `request_value_share` | `crm:write` | Propose a value for a shared CRM column on a node; member. |
| `list_value_share_requests` | `crm:read` | List value-share requests (own, or all if admin). |
| `review_value_share` | `crm:write` | Approve/reject a value-share request; admin. |
| `list_my_private_columns` | `crm:read` | List your personal (private) CRM columns. |
| `create_private_column` | `crm:write` | Create a personal private CRM column. |
| `update_private_column` | `crm:write` | Rename/change options on one of your private columns. |
| `get_private_values` | `crm:read` | Get your private CRM column values for a set of nodes. |
| `set_private_value` | `crm:write` | Set one of your private CRM column values on a node. |

### 5. `intros` (5 tools) · `tools/intros.ts`

Warm introductions (double opt-in).

| Tool | Scope | Summary |
|---|---|---|
| `list_intros` | `intros:read` | The viewer's warm-intro inbox: incoming / received / sent. |
| `count_pending_intros` | `intros:read` | Count intro requests awaiting your action (bell badge). |
| `find_mutual_introducers` | `intros:read` | People you and a target both know — candidate introducers. |
| `create_intro_request` | `intros:write` | Request a warm intro via a mutual (double opt-in). |
| `respond_to_intro` | `intros:write` | Approve/decline/accept an intro you're party to (accept seeds a DM). |

### 6. `messages` (4 tools) · `tools/messages.ts`

Read + benign state only (sending/editing/deleting is intentionally deferred).

| Tool | Scope | Summary |
|---|---|---|
| `list_conversations` | `messages:read` | List the user's conversations (DMs + groups) with unread counts. |
| `get_conversation_messages` | `messages:read` | A page of messages in a conversation you're in (cursor-paginated). |
| `search_messages` | `messages:read` | Search across the user's conversations and messages. |
| `mark_conversation_read` | `messages:read` | Mark a conversation read up to now (clears unread). Messages no one. |

### 7. `feed` (1 tool) · `tools/feed.ts`

Read-only (posting/commenting deferred).

| Tool | Scope | Summary |
|---|---|---|
| `list_feed` | `feed:read` | List recent posts in a community's social feed (cursor-paginated); member. |

### 8. `resources` (7 tools) · `tools/resources.ts`

Resource library — list, comment, propose/review changes, create record.

| Tool | Scope | Summary |
|---|---|---|
| `list_resources` | `resources:read` | List a community's resource files (with signed download URLs); member. |
| `get_resource_comments` | `resources:read` | List comments on a resource (optionally a specific cell ref); member. |
| `list_resource_changes` | `resources:read` | List proposed changes on a resource (optional status filter); member. |
| `create_resource` | `resources:write` | Create a resource record pointing at an uploaded file URL; member. |
| `comment_on_resource` | `resources:write` | Add a comment to a resource (optionally cell-anchored); member. |
| `propose_resource_change` | `resources:write` | Propose a change to a resource cell (queued for review); member. |
| `review_resource_change` | `resources:write` | Approve/reject a proposed resource change; admin. |

### 9. `blog` (2 tools) · `tools/blog.ts`

Marketing/blog authoring. Super-admin only.

| Tool | Scope | Summary |
|---|---|---|
| `create_blog_post` | `content:write` | Create a new draft blog post (returns id + slug); super-admin. |
| `update_blog_post` | `content:write` | Update a post's title/excerpt/cover/content or publish state; super-admin. |

### 10. `analytics` (2 tools) · `tools/analytics.ts`

| Tool | Scope | Summary |
|---|---|---|
| `get_community_analytics` | `analytics:read` | Growth + composition analytics for a community; member. |
| `get_community_activity` | `analytics:read` | Recent activity log for a community; admin. |

---

## Tool counts by module

| Module | Tools | State |
|---|---|---|
| events | 9 | ✅ live |
| identity | 3 | ⏸ parked |
| profile | 2 | ⏸ parked |
| directory | 12 | ⏸ parked |
| crm | 25 | ⏸ parked |
| intros | 5 | ⏸ parked |
| messages | 4 | ⏸ parked |
| feed | 1 | ⏸ parked |
| resources | 7 | ⏸ parked |
| blog | 2 | ⏸ parked |
| analytics | 2 | ⏸ parked |
| **Total** | **72** | **9 live / 63 parked** |

---

## How re-enabling works (mechanics)

`apps/web/lib/mcp/tools/index.ts` is the single switchboard. Each module is one import +
one `register*Tools(server)` call inside `registerAllTools`. To drip-feed a module back:

1. Uncomment its `import { register<Module>Tools } from "@/lib/mcp/tools/<module>";`
2. Uncomment its `register<Module>Tools(server);` line in `registerAllTools`.
3. Restart the dev server (or redeploy). The tools reappear on the MCP `tools/list`.

No scope changes are needed to re-enable — `lib/mcp/scopes.ts` still advertises every
scope; gating is enforced per-call regardless of which tools are registered.
