// Typed client for the notes REST API. Every call is scoped to a community's
// single brain (communityId) — a user's personal context is just the brain of
// their personal-space community (`me:<userId>`), so there is no scope param
// anymore. Reads use query params; mutations send a JSON body that also carries
// communityId (see lib/notes/api.ts:requireBrain). Plain fetch + thrown errors,
// matching Visvine's client conventions (no SWR/react-query).

import type {
  NoteMeta,
  TreeNode,
  References,
  NoteRevision,
  TrashEntry,
  RelatedNote,
  ReorganizePlan,
} from '@/lib/notes/shared/types'
import type {
  Folder,
  FolderLevel,
  FolderVisibility,
  JoinRequest,
  MoveProposalEntry,
  AuditEntry,
} from '@/lib/notes/shared/brainTypes'
import type { FusedResult, SearchFilters } from '@/lib/notes/shared/retrieval'

// --- brain capability types (registry / review / promote payload shapes) -------

/** A registered folder as the registry endpoint returns it: annotated with the
 *  caller's own level + capability booleans (computed server-side). */
export type RegistryFolder = Folder & {
  myLevel?: FolderLevel
  canWrite: boolean
  canAdmin: boolean
}

/** The brain gate (root registry entry, id ''): whether the community's brain is
 *  admin-gated at all and whether the CALLER may read it. `canRead: false` means
 *  the caller sees an empty brain and should request access (folderId ''). */
export interface BrainGate {
  gated: boolean
  canRead: boolean
  /** Whether the caller may write at the brain root (create root-level notes). */
  canWrite: boolean
  myLevel?: FolderLevel
}

export interface RegistryResponse {
  folders: RegistryFolder[]
  gate: BrainGate
  me: { userId: string; communityAdmin: boolean }
}

/** Discriminated payloads for POST /api/notes/registry. */
export type RegistryActionInput =
  | { action: 'register'; name: string; id?: string; visibility: FolderVisibility }
  | { action: 'unregister'; folderId: string }
  | { action: 'setVisibility'; folderId: string; visibility: FolderVisibility }
  | { action: 'setLock'; folderId: string; locked: boolean }
  | {
      action: 'setMember'
      folderId: string
      member: { userId: string; name?: string; email?: string }
      level: FolderLevel
    }
  | { action: 'removeMember'; folderId: string; userId: string }

export type PromoteResult =
  | { status: 'applied'; path: string }
  | { status: 'proposed'; proposalId: string }
  | { status: 'denied'; reason: string }

export interface ReviewIssue {
  path: string
  kind: string
  detail: string
}

export interface ReviewAutoFix {
  kind: string
  path: string
  [key: string]: unknown
}

export interface ReviewReport {
  generatedAt: string | number
  mode: 'light' | 'full'
  autoFixes: ReviewAutoFix[]
  issues: ReviewIssue[]
  counts: Record<string, number>
}

function qs(communityId: string, extra?: Record<string, string>): string {
  const params = new URLSearchParams({ communityId, ...(extra ?? {}) })
  return params.toString()
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

async function sendJson<T>(url: string, method: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

export const notesApi = {
  config: () => getJson<{ aiConfigured: boolean }>('/api/notes/config'),

  list: (c: string) => getJson<{ notes: NoteMeta[]; pinned: string[] }>(`/api/notes?${qs(c)}`),
  tree: (c: string) => getJson<{ tree: TreeNode }>(`/api/notes/tree?${qs(c)}`),

  read: (c: string, path: string) =>
    getJson<{ content: string }>(`/api/notes/item?${qs(c, { path })}`),
  create: (c: string, path: string, content?: string) =>
    sendJson<{ note: NoteMeta | null }>('/api/notes/item', 'POST', {
      communityId: c,
      path,
      content,
    }),
  write: (c: string, path: string, content: string, origin?: string) =>
    sendJson<{ ok: true }>('/api/notes/item', 'PUT', {
      communityId: c,
      path,
      content,
      origin,
    }),
  rename: (c: string, from: string, to: string) =>
    sendJson<{ path: string }>('/api/notes/item', 'PATCH', { communityId: c, from, to }),
  remove: async (c: string, path: string) => {
    const res = await fetch(`/api/notes/item?${qs(c, { path })}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error((data as { error?: string }).error || `Request failed (${res.status})`)
    }
    return res.json() as Promise<{ ok: true }>
  },

  references: (c: string, path: string) =>
    getJson<{ references: References }>(`/api/notes/references?${qs(c, { path })}`),
  related: (c: string, path: string) =>
    getJson<{ related: RelatedNote[] }>(`/api/notes/related?${qs(c, { path })}`),

  history: (c: string, path: string) =>
    getJson<{ revisions: NoteRevision[] }>(`/api/notes/history?${qs(c, { path })}`),
  restoreRevision: (c: string, path: string, revisionId: string) =>
    sendJson<{ ok: true }>('/api/notes/history', 'POST', {
      communityId: c,
      path,
      revisionId,
    }),

  createFolder: (c: string, path: string) =>
    sendJson<{ ok: true }>('/api/notes/folders', 'POST', { communityId: c, path }),
  renameFolder: (c: string, from: string, to: string) =>
    sendJson<{ path: string }>('/api/notes/folders', 'PATCH', { communityId: c, from, to }),
  deleteFolder: async (c: string, path: string) => {
    const res = await fetch(`/api/notes/folders?${qs(c, { path })}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error((data as { error?: string }).error || `Request failed (${res.status})`)
    }
    return res.json() as Promise<{ ok: true }>
  },

  trash: (c: string) => getJson<{ trash: TrashEntry[] }>(`/api/notes/trash?${qs(c)}`),
  restoreTrash: (c: string, id: string) =>
    sendJson<{ path: string }>('/api/notes/trash/restore', 'POST', { communityId: c, id }),
  emptyTrash: (c: string) =>
    sendJson<{ ok: true }>('/api/notes/trash/empty', 'POST', { communityId: c }),

  pin: (c: string, path: string, pinned: boolean) =>
    sendJson<{ ok: true }>('/api/notes/pin', 'POST', { communityId: c, path, pinned }),

  refactor: (mode: 'note' | 'selection', text: string, instruction?: string) =>
    sendJson<{ result: string }>('/api/notes/ai/refactor', 'POST', { mode, text, instruction }),
  reorganize: (c: string) =>
    sendJson<{ plan: ReorganizePlan }>('/api/notes/ai/reorganize', 'POST', {
      communityId: c,
    }),

  exportUrl: (c: string, path: string) => `/api/notes/export?${qs(c, { path })}`,
  exportAllUrl: (c: string) => `/api/notes/export/all?${qs(c)}`,

  // --- brain capabilities: fused search, folder registry, promote, capture,
  // --- review/enrich maintenance, audit ---------------------------------------

  searchNotes: (c: string, query: string, opts?: { k?: number; filters?: SearchFilters }) =>
    sendJson<{ results: FusedResult[] }>('/api/notes/search', 'POST', {
      communityId: c,
      query,
      k: opts?.k,
      filters: opts?.filters,
    }),

  getRegistry: (c: string) =>
    getJson<RegistryResponse>(`/api/notes/registry?communityId=${encodeURIComponent(c)}`),
  registryAction: (c: string, input: RegistryActionInput) =>
    sendJson<{ ok?: boolean }>('/api/notes/registry', 'POST', { communityId: c, ...input }),

  listJoinRequests: (c: string) =>
    getJson<{ requests: JoinRequest[] }>(
      `/api/notes/join-requests?communityId=${encodeURIComponent(c)}`,
    ),
  requestJoin: (c: string, folderId: string, message?: string) =>
    sendJson<{ request: JoinRequest }>('/api/notes/join-requests', 'POST', {
      communityId: c,
      folderId,
      message,
    }),
  resolveJoinRequest: (c: string, requestId: string, approve: boolean) =>
    sendJson<{ request: JoinRequest }>('/api/notes/join-requests', 'PUT', {
      communityId: c,
      requestId,
      approve,
    }),

  /** One-time share: copies `fromPath` from the CALLER's personal brain into the
   *  TARGET community's brain (`c`). The personal original stays. */
  promoteNote: (c: string, fromPath: string, toPath: string) =>
    sendJson<PromoteResult>('/api/notes/promote', 'POST', { communityId: c, fromPath, toPath }),
  listProposals: (c: string) =>
    getJson<{ proposals: MoveProposalEntry[] }>(
      `/api/notes/promote?communityId=${encodeURIComponent(c)}`,
    ),
  resolveProposal: (c: string, proposalId: string, approve: boolean) =>
    sendJson<{ proposal: MoveProposalEntry }>('/api/notes/promote', 'PUT', {
      communityId: c,
      proposalId,
      approve,
    }),

  /** Always writes to the CALLER's personal community log, whichever community
   *  the request names. */
  capture: (c: string, text: string, refs?: string[], tags?: string[]) =>
    sendJson<{ path: string }>('/api/notes/capture', 'POST', {
      communityId: c,
      text,
      refs,
      tags,
    }),

  runReview: (c: string, mode: 'light' | 'full', apply?: boolean) =>
    sendJson<{ report: ReviewReport; applied: number }>('/api/notes/review', 'POST', {
      communityId: c,
      mode,
      apply,
    }),
  /** Distills the caller's personal brain INTO community `c`'s brain. */
  runEnrich: (c: string, since?: string) =>
    sendJson<{ applied: number; considered: number }>('/api/notes/ai/enrich', 'POST', {
      communityId: c,
      since,
    }),

  getAudit: (c: string) =>
    getJson<{ entries: AuditEntry[] }>(`/api/notes/audit?communityId=${encodeURIComponent(c)}`),
}
