// Typed client for the notes REST API. Every call is scoped to a space's
// single context (spaceId) — a user's personal context is just the context of
// their personal-space space (`me:<userId>`), so there is no scope param
// anymore. Reads use query params; mutations send a JSON body that also carries
// spaceId (see lib/notes/api.ts:requireContext). Plain fetch + thrown errors,
// matching Visvine's client conventions (no SWR/react-query).

import type {
  NoteMeta,
  TreeNode,
  References,
  NoteRevision,
  TrashEntry,
  ReorganizePlan,
} from '@/lib/notes/shared/types'
import type { AccessRequest } from '@/lib/notes/shared/contextTypes'
import type { AccessLevelName, GrantSubjectType } from '@/lib/notes/shared/authz'
import type { AccessListEntry } from '@/lib/notes/access'
import type { AliasInfo } from '@/lib/notes/aliases'
import type { PublicationInfo } from '@/lib/notes/publications'
import type { FusedResult, SearchFilters } from '@/lib/notes/shared/retrieval'
import type { ContextSourceMeta } from '@/lib/notes/shared/sourceTypes'
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson'

// context access types (grant model — lib/notes/shared/authz.ts)

/** GET /api/notes/access?path= — the caller's standing at one path, plus the
 *  merged who-has-access list (readable) and grantable subjects (managers). */
export interface PathAccessResponse {
  path: string
  me: { userId: string; spaceAdmin: boolean }
  /** No grant reaches the caller ANYWHERE — the context gate is closed to them. */
  gated: boolean
  canRead: boolean
  canWrite: boolean
  canManage: boolean
  myLevel: AccessLevelName | null
  restricted: string[]
  /** Locked (AI-frozen) folders at or under `path` — managers only. */
  locked: string[]
  entries: AccessListEntry[] | null
  subjects: {
    members: Array<{ userId: string; name: string; email: string | null; image: string | null }>
    aliases: Array<{ id: string; name: string; color: string; admin: boolean; system: boolean; holderCount: number }>
  } | null
  /** Set when `path` is a sub-space's note read through this space
   *  (`spaces/<id>/…`): which sub-space. Read-only here by construction. */
  subspace?: { id: string; name: string } | null
}

/** GET /api/notes/access (no path) — the context-wide overview for tree badges
 *  and (for space admins) the full grant dump behind the Access page. */
export interface AccessOverviewResponse {
  me: { userId: string; spaceAdmin: boolean }
  gated: boolean
  restricted: string[]
  locked: string[]
  readableRoots: string[]
  grants: Array<{
    id: string
    subjectType: GrantSubjectType
    subjectId: string
    subjectName: string
    resourcePath: string
    level: number
    grantedBy: string
    createdAt: number
  }> | null
}

export type AccessActionInput =
  | { action: 'grant'; subjectType: GrantSubjectType; subjectId?: string; path: string; level: AccessLevelName }
  | { action: 'revoke'; grantId: string }
  | { action: 'restrict'; folderPath: string; restricted: boolean }
  | { action: 'setLock'; folderPath: string; locked: boolean }

type PublicationWithNames = PublicationInfo & {
  sourceSpaceName: string
  targetSpaceName: string
}

export interface PublicationStateResponse {
  asSource: PublicationWithNames[]
  asTarget: PublicationWithNames | null
}

function qs(spaceId: string, extra?: Record<string, string>): string {
  const params = new URLSearchParams({ spaceId, ...(extra ?? {}) })
  return params.toString()
}

// All calls go through lib/fetchJson so a 401 (expired session) kicks the page
// to sign-in instead of surfacing as a cryptic error.
const getJson = <T,>(url: string) => fetchJson<T>(url)
const sendJson = <T,>(url: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body: unknown) =>
  fetchJsonBody<T>(url, method, body)

export const notesApi = {
  config: () => getJson<{ aiConfigured: boolean }>('/api/notes/config'),

  /** Context display settings — currently the context's display name. */
  getContextSettings: (c: string) =>
    getJson<{ settings: { contextName: string } }>(`/api/notes/settings?${qs(c)}`),
  setContextName: (c: string, contextName: string) =>
    sendJson<{ settings: { contextName: string } }>('/api/notes/settings', 'POST', {
      spaceId: c,
      contextName,
    }),

  list: (c: string) => getJson<{ notes: NoteMeta[] }>(`/api/notes?${qs(c)}`),
  tree: (c: string) => getJson<{ tree: TreeNode }>(`/api/notes/tree?${qs(c)}`),

  read: (c: string, path: string) =>
    getJson<{ content: string }>(`/api/notes/item?${qs(c, { path })}`),
  // `movedTo` comes back when the write landed somewhere other than the path
  // asked for — the note has since become its own folder's index.
  create: (c: string, path: string, content?: string) =>
    sendJson<{ note: NoteMeta | null; movedTo?: string }>('/api/notes/item', 'POST', {
      spaceId: c,
      path,
      content,
    }),
  write: (c: string, path: string, content: string, origin?: string) =>
    sendJson<{ ok: true; movedTo?: string }>('/api/notes/item', 'PUT', {
      spaceId: c,
      path,
      content,
      origin,
    }),
  rename: (c: string, from: string, to: string) =>
    sendJson<{ path: string }>('/api/notes/item', 'PATCH', { spaceId: c, from, to }),
  remove: async (c: string, path: string) => {
    return fetchJson<{ ok: true }>(`/api/notes/item?${qs(c, { path })}`, { method: 'DELETE' })
  },

  references: (c: string, path: string) =>
    getJson<{ references: References }>(`/api/notes/references?${qs(c, { path })}`),
  /** Turn one unlinked mention of `path` (found in `fromPath` at `offset`) into a
   *  real link. Returns `path`'s refreshed references. */
  linkMention: (c: string, path: string, fromPath: string, offset: number) =>
    sendJson<{ ok: true; references: References }>('/api/notes/references', 'POST', {
      spaceId: c,
      path,
      fromPath,
      offset,
    }),

  history: (c: string, path: string) =>
    getJson<{ revisions: NoteRevision[] }>(`/api/notes/history?${qs(c, { path })}`),
  restoreRevision: (c: string, path: string, revisionId: string) =>
    sendJson<{ ok: true }>('/api/notes/history', 'POST', {
      spaceId: c,
      path,
      revisionId,
    }),

  // A folder IS its index note: pass `content` to write that note yourself (the
  // "Index" create tile), or omit it for the auto-generated stub.
  createFolder: (c: string, path: string, content?: string) =>
    sendJson<{ ok: true; indexPath: string }>('/api/notes/folders', 'POST', {
      spaceId: c,
      path,
      ...(content ? { content } : {}),
    }),
  renameFolder: (c: string, from: string, to: string) =>
    sendJson<{ path: string }>('/api/notes/folders', 'PATCH', { spaceId: c, from, to }),
  deleteFolder: async (c: string, path: string) => {
    return fetchJson<{ ok: true }>(`/api/notes/folders?${qs(c, { path })}`, { method: 'DELETE' })
  },

  trash: (c: string) => getJson<{ trash: TrashEntry[] }>(`/api/notes/trash?${qs(c)}`),
  /** One trashed note's stored markdown, for the read-only preview. */
  readTrash: (c: string, id: string) =>
    getJson<{ path: string; title: string; content: string; deletedAt: number }>(
      `/api/notes/trash/item?${qs(c, { id })}`,
    ),
  restoreTrash: (c: string, id: string) =>
    sendJson<{ path: string }>('/api/notes/trash/restore', 'POST', { spaceId: c, id }),
  purgeTrash: (c: string, id: string) =>
    sendJson<{ ok: true }>('/api/notes/trash/purge', 'POST', { spaceId: c, id }),
  emptyTrash: (c: string) =>
    sendJson<{ ok: true }>('/api/notes/trash/empty', 'POST', { spaceId: c }),

  refactor: (mode: 'note' | 'selection', text: string, instruction?: string) =>
    sendJson<{ result: string }>('/api/notes/ai/refactor', 'POST', { mode, text, instruction }),
  reorganize: (c: string) =>
    sendJson<{ plan: ReorganizePlan }>('/api/notes/ai/reorganize', 'POST', {
      spaceId: c,
    }),

  // --- context capabilities: fused search, folder registry, access, publishing

  searchNotes: (c: string, query: string, opts?: { k?: number; filters?: SearchFilters }) =>
    sendJson<{ results: FusedResult[] }>('/api/notes/search', 'POST', {
      spaceId: c,
      query,
      k: opts?.k,
      filters: opts?.filters,
    }),

  /** The caller's standing at one path ('' = context root) + who-has-access list. */
  getAccess: (c: string, path: string) =>
    getJson<PathAccessResponse>(`/api/notes/access?${qs(c, { path })}`),
  /** Context-wide access overview (restricted/locked folders, gate) for badges. */
  getAccessOverview: (c: string) =>
    getJson<AccessOverviewResponse>(`/api/notes/access?${qs(c)}`),
  accessAction: (c: string, input: AccessActionInput) =>
    sendJson<{ ok?: boolean }>('/api/notes/access', 'POST', { spaceId: c, ...input }),

  listAliases: (c: string) => getJson<{ aliases: AliasInfo[] }>(`/api/aliases?${qs(c)}`),
  aliasAction: (
    c: string,
    input:
      | { action: 'create'; name: string; color: string }
      | { action: 'update'; name: string; newName?: string; color?: string }
      | { action: 'delete'; name: string }
      | { action: 'setAdmin'; name: string; admin: boolean }
      | { action: 'addHolder'; name: string; userId: string }
      | { action: 'removeHolder'; name: string; userId: string },
  ) => sendJson<{ ok?: boolean }>('/api/aliases', 'POST', { spaceId: c, ...input }),

  /** How `path` participates in publishing, from space `c`'s point of view. */
  getPublications: (c: string, path: string) =>
    getJson<PublicationStateResponse>(`/api/notes/publications?${qs(c, { path })}`),
  /** Publish a note the caller can read (default source: their personal context)
   *  into space `c`. Queues a proposal when they can't write the target. */
  publish: (c: string, input: { fromSpaceId: string; fromPath: string; toPath: string }) =>
    sendJson<
      | { status: 'applied'; publication: PublicationInfo }
      | { status: 'proposed'; proposalId: string }
    >('/api/notes/publications', 'POST', { spaceId: c, action: 'publish', ...input }),
  unpublish: (c: string, id: string) =>
    sendJson<{ publication: PublicationInfo }>('/api/notes/publications', 'POST', {
      spaceId: c,
      action: 'unpublish',
      id,
    }),

  /** Own requests + every request for a path the caller manages, newest first. */
  listAccessRequests: (c: string) =>
    getJson<{ requests: AccessRequest[]; pending: number }>(
      `/api/notes/access-requests?spaceId=${encodeURIComponent(c)}`,
    ),
  /** Ask for access to `resourcePath` ('' = the context root gate). Idempotent. */
  requestAccess: (c: string, resourcePath: string, message?: string) =>
    sendJson<{ request: AccessRequest }>('/api/notes/access-requests', 'POST', {
      spaceId: c,
      resourcePath,
      message,
    }),
  /** Ask for access to the hidden source note behind a locked reference stub on
   *  `path`. The stub's opaque token stands in for the source's path — the
   *  server resolves it, so the client never learns which note it is. */
  requestReferenceAccess: (c: string, path: string, referenceToken: string) =>
    sendJson<{ request: AccessRequest }>('/api/notes/access-requests', 'POST', {
      spaceId: c,
      path,
      referenceToken,
    }),
  /** Approve (granting `level`, default = what was asked for) or deny. */
  resolveAccessRequest: (c: string, requestId: string, approve: boolean, level?: AccessLevelName) =>
    sendJson<{ request: AccessRequest }>('/api/notes/access-requests', 'PUT', {
      spaceId: c,
      requestId,
      approve,
      level,
    }),

  // context sources (non-note files/tables attached to the context)

  listSources: (c: string, folderId?: string) =>
    getJson<{ sources: ContextSourceMeta[] }>(
      `/api/notes/sources?${qs(c, folderId !== undefined ? { folderId } : undefined)}`,
    ),
  /** Multipart upload — spaceId travels in the query string (no JSON body). */
  uploadSource: async (c: string, file: File, folder?: string) => {
    const form = new FormData()
    form.append('file', file)
    if (folder) form.append('folder', folder)
    return fetchJson<{ source: ContextSourceMeta }>(`/api/notes/sources?${qs(c)}`, { method: 'POST', body: form })
  },
  readSource: (c: string, path: string, opts?: { offset?: number; maxChars?: number }) =>
    getJson<{ source: ContextSourceMeta; text: string; totalChars: number; downloadUrl: string | null }>(
      `/api/notes/sources/item?${qs(c, {
        path,
        ...(opts?.offset !== undefined ? { offset: String(opts.offset) } : {}),
        ...(opts?.maxChars !== undefined ? { maxChars: String(opts.maxChars) } : {}),
      })}`,
    ),
  reingestSource: (c: string, path: string) =>
    sendJson<{ source: ContextSourceMeta }>('/api/notes/sources/item', 'POST', {
      spaceId: c,
      path,
      action: 'reingest',
    }),
  deleteSource: async (c: string, path: string) => {
    return fetchJson<{ ok: true }>(`/api/notes/sources?${qs(c, { path })}`, { method: 'DELETE' })
  },
}
