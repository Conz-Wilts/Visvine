// Types shared by the notes pure-logic layer (index/tree/context/backlinks/related)
// and the server store + API. Keep this file free of Node/DOM imports so it runs on the server and the client.

export type { References, LinkedReference, UnlinkedReference, RestrictedReference } from './references'

// The subset of YAML frontmatter the app reasons about. Any other keys are kept
// verbatim via the index signature. Fields follow the OKF v0.1 convention.
export interface NoteFrontmatter {
  type?: string // concept kind (e.g. "Note", "Playbook")
  title?: string
  description?: string
  resource?: string // canonical URI for the underlying asset
  tags?: string[]
  timestamp?: string // ISO 8601 last-modified datetime
  author?: string // display name of the user who created the note
  // Memory lifecycle (shared/lifecycle.ts). Every field is optional: a note
  // with none of them reads as active, current, and permanent.
  status?: string // NoteStatus — active | proposed | accepted | stale | superseded | deprecated | expired | archived | rejected
  confidence?: string // Confidence — certain | likely | speculative
  expires?: string // ISO date/datetime after which the claim is no longer current
  supersedes?: string | string[] // note path(s) this note replaces
  superseded_by?: string // note path that replaced this one (set by the clean pass)
  [key: string]: unknown
}

// A note as read straight from the store: its context-relative POSIX path, raw
// markdown, and last-modified time (epoch ms).
export interface RawNote {
  path: string
  content: string
  mtime: number
}

// A note enriched with everything the UI and context need, computed from the raw
// markdown plus knowledge of every other note (to resolve OKF markdown links).
export interface NoteMeta {
  path: string // context-relative POSIX path, e.g. "projects/acme.md"
  title: string // frontmatter.title, else the filename without extension
  folder: string // parent folder POSIX path, "" for the context root
  frontmatter: NoteFrontmatter
  tags: string[] // frontmatter tags + inline #hashtags from the body (not context edges)
  linkTargets: string[] // resolved paths of notes this note links to
  unresolved: string[] // markdown link hrefs that matched no existing note
  mtime: number
}

// A node in the folder/note tree shown in the sidebar.
export interface TreeNode {
  name: string // the path segment (folder or file name)
  path: string // context-relative POSIX path
  kind: 'folder' | 'note'
  title?: string // display title for notes
  // Set on a note that declares a config kind (`type: connector` / `type:
  // model`, lib/notes/shared/configKinds.ts) wherever it sits, and on a folder
  // that IS an agent (lib/agents/shared/folder.ts), so the sidebar can offer
  // the moves each is allowed and not the ones it is not.
  declares?: 'connector' | 'model' | 'agent'
  children?: TreeNode[]
  // Set on a folder somebody has arranged: its index note's `order:` list,
  // which sortTree honours ahead of the by-name sort (folderOrder.ts).
  order?: string[]
  // Set on the folder a sub-space is read through (`subspaces/<id>`): the id
  // of that space. Everything under it is that space's own context, rebased
  // into this tree (lib/spaces/subspaces.ts).
  space?: string
  // Set with `space` when the viewer stands in that sub-space — a member or
  // an admin of it — so its rows take the edit affordances the space's own
  // rows do. Each write is still judged in the sub-space, per path
  // (lib/notes/federation.ts#writeTarget). Absent: read-only here.
  writable?: boolean
  // Set on a row the tree DRAWS but nothing stores: `main`, the tier holding
  // the space's own context under the space row (lib/notes/shared/rootTiers.ts).
  // Its path is reserved, so it is never dragged, dropped on, shared or
  // deleted, and its index note is the context root's.
  drawn?: 'main'
  // Set on the two roots another space's context is read through — the
  // `Sub-spaces` folder and `parent/`. Nothing of this space's own is stored
  // under either, so the tree draws them as their own tier, after every folder
  // the space actually holds (`context.ts#sortTree`).
  federated?: boolean
  // Set on the `parent` folder: what the space this one sits inside shares
  // with it (connectors and agents flagged `share: subspaces`), read-only
  // (lib/spaces/subspaces.ts#graftParent). `space` then names the parent.
  parent?: boolean
}

// A note sitting in the trash (soft-deleted), awaiting restore or purge.
// How long a soft-deleted note is kept before it is purged for good. Shared so
// the tree can show the countdown the server enforces.
export const TRASH_RETENTION_DAYS = 7

export interface TrashEntry {
  id: string // the note row id
  name: string // the note's original base filename
  title: string // the note's display name (frontmatter title, else the filename)
  path: string // the note's original context-relative path
  deletedAt: number // epoch ms
}

// Revision history

// How a note revision came to be. 'baseline' is the pre-edit snapshot seeded on
// the first edit; 'ai-refactor' is an LLM rewrite; 'ai-enrich' is an insight
// distilled from a personal context by the enrichment pass; 'agent' is an external
// agent writing through MCP; 'maintenance' is a rule-based review auto-fix;
// 'restore' is reverting to an earlier version; 'publish' is a replica refresh
// written by a cross-context publication (lib/notes/publications.ts — the origin
// also guards against replication cascades); 'edit' is an ordinary manual save.
export type NoteRevisionOrigin =
  | 'edit'
  | 'ai-refactor'
  | 'ai-enrich'
  | 'agent'
  | 'maintenance'
  | 'restore'
  | 'baseline'
  | 'publish'

// One point-in-time snapshot of a note. The full content is stored so any past
// version can be reviewed and restored.
export interface NoteRevision {
  id: string // the revision row id
  at: number // epoch ms of the save
  editor: string // display name of who saved it, or 'Unknown'
  editorEmail?: string
  origin: NoteRevisionOrigin
  model?: string // the LLM model (or agent client), when AI/agent-originated
  content: string // full note snapshot (frontmatter + body) at this save
}

// Reorganize (agentic notes folder cleanup)

// One proposed file move in a reorganization plan.
export interface MoveProposal {
  from: string
  to: string
  reason: string
}

// The output of the reorganize workflow: a human-readable summary and the moves
// to review. Empty `moves` means the context already looks well organised.
export interface ReorganizePlan {
  summary: string
  moves: MoveProposal[]
}
