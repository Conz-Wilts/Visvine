// Types shared by the notes pure-logic layer (index/tree/context/backlinks/related)
// and the server store + API. Ported from blackbird-brain's src/shared/types.ts,
// trimmed to the core note-taking surface — the knowledge-brain, shared-brain
// sync, and Electron `BrainApi` types are intentionally dropped (out of scope).
// Keep this file free of Node/DOM imports so it runs on the server and the client.

import type { RelatedNote } from './related'

export type { RelatedNote }
export type { References, LinkedReference, UnlinkedReference } from './references'

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
  [key: string]: unknown
}

// A note as read straight from the store: its brain-relative POSIX path, raw
// markdown, and last-modified time (epoch ms).
export interface RawNote {
  path: string
  content: string
  mtime: number
}

// A note enriched with everything the UI and context need, computed from the raw
// markdown plus knowledge of every other note (to resolve OKF markdown links).
export interface NoteMeta {
  path: string // brain-relative POSIX path, e.g. "projects/acme.md"
  title: string // frontmatter.title, else the filename without extension
  folder: string // parent folder POSIX path, "" for the brain root
  frontmatter: NoteFrontmatter
  tags: string[] // frontmatter tags + inline #hashtags from the body (not context edges)
  linkTargets: string[] // resolved paths of notes this note links to
  unresolved: string[] // markdown link hrefs that matched no existing note
  mtime: number
}

// A node in the folder/note tree shown in the sidebar.
export interface TreeNode {
  name: string // the path segment (folder or file name)
  path: string // brain-relative POSIX path
  kind: 'folder' | 'note'
  title?: string // display title for notes
  children?: TreeNode[]
}

// A note sitting in the trash (soft-deleted), awaiting restore or purge.
export interface TrashEntry {
  id: string // the note row id
  name: string // the note's original base filename
  path: string // the note's original brain-relative path
  deletedAt: number // epoch ms
}

// --- Revision history --------------------------------------------------------

// How a note revision came to be. 'baseline' is the pre-edit snapshot seeded on
// the first edit; 'ai-refactor' is an LLM rewrite; 'ai-enrich' is an insight
// distilled from a personal brain by the enrichment pass; 'agent' is an external
// agent writing through MCP; 'maintenance' is a rule-based review auto-fix;
// 'restore' is reverting to an earlier version; 'publish' is a replica refresh
// written by a cross-brain publication (lib/notes/publications.ts — the origin
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

// --- Reorganize (agentic notes folder cleanup) -------------------------------

// One proposed file move in a reorganization plan.
export interface MoveProposal {
  from: string
  to: string
  reason: string
}

// The output of the reorganize workflow: a human-readable summary and the moves
// to review. Empty `moves` means the brain already looks well organised.
export interface ReorganizePlan {
  summary: string
  moves: MoveProposal[]
}
